import type { Metadata } from "next";

import "../../landing.css";
import "../../m/[serial]/mandate.css";
import "../../verify/verify.css";

import { VerifyResultCard } from "@/components/VerifyResultCard";
import { fetchMandate, mandateApiBase, MANDATE_SERIAL_RE } from "@/lib/mandate";
import { PASS_TOKEN_CSS } from "@/lib/pass-token-css";

/**
 * `/v/:serial` — the read-only record a counterparty opens from `/verify` (#463).
 *
 * This is the shareable answer. It shows the principal, the limits, the expiry, the status, the verdict for the party
 * reading it, and when the record was read. It deliberately does **not** show a payee list, a spend history, an agent
 * address, a token or a revoke control: a counterparty needs to know the limits are real, not who else was paid, and a
 * read-only page should have no control that cannot work.
 *
 * **No enumeration.** The route knows exactly one serial — the path segment it was given. There is no list, no
 * "recent mandates", no autocomplete and no link to a sibling serial anywhere on this page. A serial is a capability;
 * a page that discovers them leaks them.
 *
 * `/verify` is the place to type one in. This page is where a QR or a message can point.
 */

export const metadata: Metadata = {
  title: "Pass record",
  description: "The public record behind a Vouch pass: status, limits, expiry, verdict and when it was read.",
  robots: { index: false, follow: false, nocache: true },
};

/** A cached `active` would outlive a revocation; this route is the one where that is a safety incident. */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type PageProps = { params: Promise<{ serial: string }> };

export default async function PassRecordPage({ params }: PageProps) {
  const { serial } = await params;
  const fetchedAt = new Date().toISOString();

  // A malformed path segment is a damaged link, not a record to look up. It renders the same do-not-trust answer as
  // `unknown` without a request — the endpoint would answer 400, which is a framework error, not a verification.
  const state = MANDATE_SERIAL_RE.test(serial)
    ? await fetchMandate(serial, { apiBase: mandateApiBase() })
    : { kind: "malformed" as const, serial };

  return (
    <main className="mandate-page">
      <style>{PASS_TOKEN_CSS}</style>
      <div className="verify-stack">
        <VerifyResultCard state={state} details fetchedAt={fetchedAt} />
      </div>
    </main>
  );
}
