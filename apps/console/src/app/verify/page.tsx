import type { Metadata } from "next";

import "../landing.css";
import "../m/[serial]/mandate.css";
import "./verify.css";

import { VerifyResultCard } from "@/components/VerifyResultCard";
import { fetchMandate, mandateApiBase, MANDATE_SERIAL_RE, type MandateRead } from "@/lib/mandate";
import { PASS_TOKEN_CSS } from "@/lib/pass-token-css";
import { serialFromInput } from "@/lib/verify-answer";

/**
 * `/verify` — the page a counterparty uses to check a pass before accepting it (#463).
 *
 * The holder already has `/m/:serial`; this page exists for the seller, the accountant, the person handed a phone. It
 * takes one serial — pasted, or a `/m/`/`/v/` link from a QR — and answers `active`, `revoked`, `expired` or
 * `unknown` in plain words.
 *
 * Three rules, the same three `/m/:serial` runs on:
 *
 *  1. **No caching.** A cached `active` outlives a revocation. `force-dynamic`, `revalidate = 0` and `no-store` in
 *     `fetchMandate` are the whole safety story.
 *  2. **`unknown` is an answer, not an error.** It says "No mandate with that serial. Do not trust the pass." in
 *     those words, and it wears the same dead plate as `revoked`. A soft "not found" is the defect this page exists
 *     to avoid.
 *  3. **The page is not a directory.** There is no search, no "recent passes", no autocomplete and no call that lists
 *     anything. The only serial this page knows is the one in the query string; a serial is a capability, and a page
 *     that discovers them leaks them.
 *
 * The form is a plain GET form, server-rendered, so the page works with JavaScript disabled. It may be enhanced later;
 * the answer must never depend on that.
 */

export const metadata: Metadata = {
  title: "Verify a pass",
  description: "Check a Vouch pass: its status, limits, expiry and when the record was read.",
  robots: { index: false, follow: false, nocache: true },
};

/** A cached HTML 200 on this route is a safety incident, not a performance choice. */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type PageProps = { searchParams: Promise<{ serial?: string | string[] }> };

export default async function VerifyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.serial) ? params.serial[0] : params.serial;
  const input = typeof raw === "string" ? raw : "";
  const serial = serialFromInput(input);
  const fetchedAt = new Date().toISOString();

  let state: MandateRead | { kind: "malformed"; serial: string } | null = null;
  if (input.trim() !== "") {
    state = MANDATE_SERIAL_RE.test(serial)
      ? await fetchMandate(serial, { apiBase: mandateApiBase() })
      : { kind: "malformed", serial: input };
  }

  return (
    <main className="mandate-page">
      <style>{PASS_TOKEN_CSS}</style>
      <div className="verify-stack">
        <article className="mandate-card verify-form-card">
          <header className="verify-form-head">
            <div className="verify-form-brand">
              <span className="verify-form-wordmark">vouchguard</span>
              <span className="verify-form-vouched">vouched by PayStage</span>
            </div>
            <h1 className="verify-form-title">Check a pass.</h1>
            <p className="verify-form-lede">
              A pass carries a spending limit. Paste its serial, or the link from its QR, to see whether it is still in
              force.
            </p>
          </header>

          <form className="verify-form-body" method="get" action="/verify" autoComplete="off">
            <label className="verify-label" htmlFor="serial">
              Pass serial
            </label>
            <div className="verify-input-row">
              <input
                className="verify-input"
                id="serial"
                name="serial"
                type="text"
                defaultValue={input}
                placeholder="vch_… or a /v/ link"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              <button className="verify-button" type="submit">
                Check this pass
              </button>
            </div>
            <p className="verify-hint">
              This page looks up only the serial you give it. It does not list passes, suggest serials or remember them.
            </p>
          </form>
        </article>

        {state ? <VerifyResultCard state={state} fetchedAt={fetchedAt} /> : null}
      </div>
    </main>
  );
}
