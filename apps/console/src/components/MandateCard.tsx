import type { ReactNode } from "react";
import {
  STATUS_COPY,
  formatInstant,
  formatWindow,
  mandateJsonUrl,
  type MandateRead,
} from "@/lib/mandate";
import { PassHead, stateTint } from "@/components/PassHead";
import { PASS_TOKEN_CSS } from "@/lib/pass-token-css";

/**
 * The card a counterparty sees after pointing a camera at someone else's pass (#436), restyled so it is the pass
 * rather than a page that was reviewed against one (#440).
 *
 * Order is the pass's own:
 *
 *  1. **the poster**: the mandate's tint, the venn mark top-left, the status chip top-right. This is the pass's
 *     head, not a page header — the site header is hidden for this route in `mandate.css`;
 *  2. **the fields**, in the pass's order and type scale — `$2.00 each purchase · $20.00 per 24h`, then EXPIRES,
 *     then PRINCIPAL;
 *  3. **the record's state** — the meaning, the read time, the honesty line and the write note.
 *
 * Every colour, type size and the pad ratio come from `apps/console/src/lib/pass-tokens.json`, the file
 * `scripts/lib/pass-face.mjs` draws the Wallet assets from. The poster's mark is `/pass/mark-*.svg`, rendered from
 * the same `vennMark()` by `scripts/render-pass-assets.mjs`, so it is not a second drawing either.
 *
 * It renders **only** fields the endpoint returned. No payee list, no spend history, no agent address,
 * no refusals — the proposal's §7 is a privacy boundary, not a styling choice. The write half is
 * deliberately absent: a change needs a signature from the account that holds the authority, and the
 * endpoint does not accept one yet, so the page says that once rather than offering a control that
 * cannot work.
 */

export const HONESTY_LINE =
  "Revocation is instant server-side; this card is the record at the time above, and the QR is authoritative.";

export const WRITE_NOTE =
  "Changing the limit, the payees or ending this mandate requires a signature from the account that holds the authority. The endpoint and this page do not support that yet.";

export type MandateViewState = MandateRead | { kind: "malformed"; serial: string };

function WriteNote() {
  return (
    <p className="mandate-note">
      <strong>To change anything:</strong> {WRITE_NOTE}
    </p>
  );
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="mandate-field-label">{label}</p>
      <p className="mandate-field-value">{value}</p>
    </div>
  );
}

export function MandateCard({ state }: { state: MandateViewState }) {
  if (state.kind === "malformed") {
    return (
      <main className="mandate-page">
        <style>{PASS_TOKEN_CSS}</style>
        <article className="mandate-card mandate-plain">
          <section className="mandate-fields">
            <p className="mandate-label">Vouch mandate</p>
            <p className="mandate-record">{state.serial}</p>
            <h1 className="mandate-title">That is not a serial.</h1>
            <p className="mandate-copy">
              A Vouch serial is <code>vch_</code> followed by at least 22 characters, or the short code{" "}
              <code>vch-ABC</code>. Nothing was looked up.
            </p>
          </section>
        </article>
      </main>
    );
  }

  if (state.kind === "unreadable") {
    return (
      <main className="mandate-page">
        <style>{PASS_TOKEN_CSS}</style>
        <article className="mandate-card" style={{ "--pass-tint": stateTint("unreadable") } as React.CSSProperties}>
          <PassHead status="unreadable" />
          <section className="mandate-state">
            <p className="mandate-record">Serial {state.serial}</p>
            <p className="mandate-meaning">Could not read the record — do not trust this pass.</p>
            <p className="mandate-copy">{state.reason}. Ask the holder to show it again.</p>
            <WriteNote />
          </section>
        </article>
      </main>
    );
  }

  const { payload, apiBase } = state;
  const copy = STATUS_COPY[payload.status];
  const known = payload.scope !== null;

  return (
    <main className="mandate-page">
      <style>{PASS_TOKEN_CSS}</style>
      <article className="mandate-card" style={{ "--pass-tint": stateTint(payload.status) } as React.CSSProperties}>
        <PassHead status={payload.status} />

        {known && payload.principal && payload.scope ? (
          <section className="mandate-fields" aria-label="Caps">
            <p className="mandate-label">UP TO</p>
            <p className="mandate-limit">${payload.scope.per_payment}</p>
            <p className="mandate-caption">
              each purchase · ${payload.scope.window_amount} per {formatWindow(payload.scope.window_seconds)}
            </p>
            <div className="mandate-field-row">
              <FieldRow label="EXPIRES" value={formatInstant(payload.scope.expires_at)} />
              <FieldRow
                label="PRINCIPAL"
                value={
                  <>
                    {payload.principal.display} <span className="mandate-self">(self-asserted)</span>
                  </>
                }
              />
            </div>
          </section>
        ) : null}

        <section className="mandate-state">
          <p className="mandate-meaning">{copy.meaning}</p>
          <p className="mandate-record">Serial {payload.serial}</p>
          <p className="mandate-record">Record read {formatInstant(payload.as_of)}.</p>

          <hr className="mandate-rule" />
          <p className="mandate-note">{HONESTY_LINE}</p>
          <WriteNote />

          {known ? (
            <p className="mandate-record">
              <a className="mandate-link" href={mandateJsonUrl(payload.serial, apiBase)} rel="noreferrer">
                JSON record
              </a>
            </p>
          ) : null}
        </section>
      </article>
    </main>
  );
}
