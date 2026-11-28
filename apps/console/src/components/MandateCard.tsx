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
 *  1. **the poster**: the mandate's tint, the ticket mark top-left, the status chip top-right. This is the pass's
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
 * no refusals — the proposal's §7 is a privacy boundary, not a styling choice. There is still no
 * control: ending a mandate is a signed statement sent by the issuer or manager to
 * `POST /v1/mandate/:serial/revoke`, and a button on a public serial page would be a capability
 * anyone with the link could press. The page explains both that path and the Wallet-only act of
 * removing the card, because those are different things (#503).
 */

export const HONESTY_LINE =
  "Revocation is instant server-side; this card is the record at the time above, and the QR is authoritative.";

/**
 * How to take the card off the phone (#503). This is a Wallet feature, not something this page can
 * do: the pass is a receipt, and the link inside it is the live record.
 */
export const REMOVE_PASS_GUIDANCE =
  "To remove the pass from this phone, open Wallet, long-press the pass, then choose Remove Pass.";

/**
 * The distinction the removal block exists for. Removing the card changes one phone; it does not
 * change the record. Only a signed revocation statement does, which is why the sentence names
 * `/verify` rather than a menu.
 */
export const REMOVAL_IS_NOT_REVOCATION =
  "Removing it from the phone does not revoke the mandate; anyone who kept a screenshot of the serial can still check it, and it will still say active. Revoking is what makes /verify answer \"do not trust\".";

/** Say plainly that the card is a receipt: it cannot repaint itself without a PassKit web service. */
export const PASS_IS_A_RECEIPT =
  "The pass card on the phone does not update itself; this page is the live record it points to.";

export const WRITE_NOTE =
  "Changing the limit or the payees requires a signature from the account that holds the authority. Ending the mandate is a signed revocation statement sent to the record service; this page is a record, not a control.";

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

          <div className="mandate-removal">
            <p className="mandate-note">
              <strong>Removing the pass from the phone:</strong> {REMOVE_PASS_GUIDANCE}
            </p>
            <p className="mandate-note">{REMOVAL_IS_NOT_REVOCATION}</p>
            <p className="mandate-note">{PASS_IS_A_RECEIPT}</p>
          </div>

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
