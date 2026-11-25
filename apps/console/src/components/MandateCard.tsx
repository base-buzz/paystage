import type { ReactNode } from "react";
import {
  STATUS_COPY,
  formatInstant,
  formatWindow,
  mandateJsonUrl,
  type MandateRead,
} from "@/lib/mandate";
import { PASS_TOKENS } from "@/lib/pass-tokens";

/**
 * The card a counterparty sees after pointing a camera at someone else's pass (#436), restyled so it is the pass
 * rather than a page that was reviewed against one (#440).
 *
 * Order is the pass's own:
 *
 *  1. **the poster**: the mandate's tint, the keyway mark top-left, the status chip top-right. This is the pass's
 *     head, not a page header — the site header is hidden for this route in `mandate.css`;
 *  2. **the fields**, in the pass's order and type scale — `$2.00 each purchase · $20.00 per 24h`, then EXPIRES,
 *     then PRINCIPAL;
 *  3. **the record's state** — the meaning, the read time, the honesty line and the write note.
 *
 * Every colour, type size and the pad ratio come from `apps/console/src/lib/pass-tokens.json`, the file
 * `scripts/lib/pass-face.mjs` draws the Wallet assets from. The poster's mark is `/pass/mark-*.svg`, rendered from
 * the same `sealMark()` by `scripts/render-pass-assets.mjs`, so it is not a second drawing either.
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

const { palette, type, spacing, geometry } = PASS_TOKENS;

/**
 * The token file as CSS custom properties on `:root`, so `mandate.css` can name a value without repeating it. This
 * is the only place the page writes a colour or a size down, and every value comes from the JSON.
 */
const TOKEN_CSS = [
  ":root{",
  `--pass-ink:${palette.ink};`,
  `--pass-paper:${palette.paper};`,
  `--pass-deep:${palette.deep};`,
  `--pass-gold:${palette.gold};`,
  `--pass-muted:${palette.muted};`,
  `--pass-red:${palette.red};`,
  /* The mandate endpoint (#423) returns no teammate name, so the default tint is the one `tintFor("")` returns.
     The state override is per-mandate and lives on the card (see `stateTint`), not here. */
  `--pass-tint:${PASS_TOKENS.posterTints[0]};`,
  `--pass-type-name:${type.name};`,
  `--pass-type-value:${type.value};`,
  `--pass-type-label:${type.label};`,
  `--pass-type-caption:${type.caption};`,
  `--pass-type-field-label:${type.fieldLabel};`,
  `--pass-type-field:${type.field};`,
  `--pass-type-brand:${type.brand};`,
  `--pass-type-sub-brand:${type.subBrand};`,
  `--pass-type-chip:${type.chip};`,
  `--pass-type-meta:${type.meta};`,
  `--pass-pad:${spacing.pad};`,
  /* The pass's poster band, as an aspect ratio: full height × the bare (no-teammate) poster share. */
  `--pass-poster-aspect:${(geometry.aspect * geometry.posterShareBare).toFixed(4)};`,
  "}",
].join("");

/**
 * The pass face has four marks and no `unknown` one, so the two states it never has use the empty-lock mark: a
 * fifth drawing is exactly the drift this row removes.
 */
function markFor(status: string): "active" | "revoked" | "expired" {
  if (status === "active") return "active";
  if (status === "revoked") return "revoked";
  return "expired";
}

/**
 * State treatment mirrors the pass: a revoked or expired mandate has no colour left in it, because a page that stays
 * blue while the card greys out is two answers to the same question. The pass greys its plate; this greys the tint.
 * Same rule, one token — and the value comes from `pass-tokens.json`, so the page cannot drift from the renderer.
 */
function stateTint(status: string): string {
  return status === "revoked" || status === "expired" ? PASS_TOKENS.state.deadPlate : PASS_TOKENS.posterTints[0];
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className="mandate-chip" data-dead={status === "active" ? "false" : "true"}>
      {status}
    </span>
  );
}

/**
 * The pass's head. It is deliberately the same three things the renderer draws in the poster band — mark, wordmark,
 * chip — and nothing else.
 *
 * **No teammate name.** `GET /v1/mandate/:serial` (#423) does not return one, so the poster is rendered without it.
 * A placeholder or an invented name would be a claim about who holds the mandate; the space stays empty until the
 * endpoint carries the name, at which point it goes here at `--pass-type-name` and the tint is derived the same way
 * `tintFor` derives the pass's.
 */
function PosterHead({ status }: { status: string }) {
  return (
    <header className="mandate-poster">
      <img className="mandate-mark" src={`/pass/mark-${markFor(status)}.svg`} alt="" width={100} height={100} />
      <div className="mandate-brand">
        <span className="mandate-wordmark">vouchguard</span>
        <span className="mandate-vouched">vouched by PayStage</span>
      </div>
      <StatusChip status={status} />
    </header>
  );
}

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
        <style>{TOKEN_CSS}</style>
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
        <style>{TOKEN_CSS}</style>
        <article className="mandate-card" style={{ "--pass-tint": stateTint("unreadable") } as React.CSSProperties}>
          <PosterHead status="unreadable" />
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
      <style>{TOKEN_CSS}</style>
      <article className="mandate-card" style={{ "--pass-tint": stateTint(payload.status) } as React.CSSProperties}>
        <PosterHead status={payload.status} />

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
