import type { CSSProperties, ReactNode } from "react";

import { PassHead, stateTint } from "@/components/PassHead";
import { formatInstant, formatWindow, type MandateRead } from "@/lib/mandate";
import { answerFor, UNKNOWN_ANSWER, verdictForDisplay } from "@/lib/verify-answer";

/**
 * The answer card `/verify` and `/v/:serial` share.
 *
 * It renders only the fields the public record returns: serial, status, scope, principal, verdict and `as_of`. There is
 * deliberately no payee list, no spend history, no agent address and no token on this card — a counterparty needs to
 * know the limits are real, not who else was paid. `parseMandatePayload` drops everything else before this component
 * sees it.
 *
 * `unknown`, `malformed` and `unreadable` all wear the same dead plate as `revoked`. Unknown is an answer, not an
 * error: a reader who sees red for revoked and a soft "not found" for unknown has been given two policies.
 */

export type VerifyViewState = MandateRead | { kind: "malformed"; serial: string };

export function VerifyResultCard({
  state,
  details = false,
  fetchedAt,
}: {
  state: VerifyViewState;
  /** `/v/:serial` shows the full fact list; `/verify` keeps the answer short and links to the full record. */
  details?: boolean;
  /** The page's own read time, used only when there is no record to carry an `as_of`. */
  fetchedAt: string;
}) {
  const status =
    state.kind === "record" ? state.payload.status : state.kind === "unreadable" ? "unreadable" : "unknown";
  const answer =
    state.kind === "record"
      ? answerFor(state.payload)
      : state.kind === "unreadable"
        ? {
            status: "unknown" as const,
            sentence: "Could not read the record — do not trust this pass.",
            next: "Do not accept it; try again when the record service is reachable.",
          }
        : UNKNOWN_ANSWER;

  return (
    <article className="mandate-card verify-card" style={{ "--pass-tint": stateTint(status) } as CSSProperties}>
      <PassHead status={status} />
      <section className="mandate-state">
        <p className="mandate-meaning verify-sentence">{answer.sentence}</p>
        <p className="mandate-copy verify-next">{answer.next}</p>

        {state.kind === "record" ? (
          <>
            {details && state.payload.scope !== null ? (
              <div className="mandate-field-row verify-facts" aria-label="Record facts">
                <Field
                  label="PRINCIPAL"
                  value={
                    state.payload.principal ? (
                      <>
                        {state.payload.principal.display} <span className="mandate-self">(self-asserted)</span>
                      </>
                    ) : (
                      "—"
                    )
                  }
                />
                <Field label="PER PURCHASE" value={state.payload.scope ? `$${state.payload.scope.per_payment}` : "—"} />
                <Field
                  label={
                    state.payload.scope ? `PER ${formatWindow(state.payload.scope.window_seconds).toUpperCase()}` : "WINDOW"
                  }
                  value={state.payload.scope ? `$${state.payload.scope.window_amount}` : "—"}
                />
                <Field label="EXPIRES" value={state.payload.scope ? formatInstant(state.payload.scope.expires_at) : "—"} />
                <Field label="STATUS" value={state.payload.status} />
                <Field
                  label="VERDICT FOR YOU"
                  value={
                    <>
                      {verdictForDisplay(state.payload.verdict_for_seller).label}
                      <span className="mandate-self">
                        {" "}
                        — {verdictForDisplay(state.payload.verdict_for_seller).meaning}
                      </span>
                    </>
                  }
                />
              </div>
            ) : null}
            <p className="mandate-record">Fetched at {formatInstant(state.payload.as_of)}.</p>
            <p className="mandate-record">Serial {state.payload.serial}</p>
            {!details ? (
              <>
                <hr className="mandate-rule" />
                <p className="mandate-record">
                  <a className="mandate-link" href={`/v/${encodeURIComponent(state.payload.serial)}`}>
                    Full record at /v/{state.payload.serial}
                  </a>
                </p>
              </>
            ) : null}
          </>
        ) : null}

        {state.kind === "unreadable" ? (
          <>
            <p className="mandate-copy">{state.reason}.</p>
            <p className="mandate-record">Fetched at {formatInstant(fetchedAt)}.</p>
            <p className="mandate-record">Serial {state.serial}</p>
          </>
        ) : null}

        {state.kind === "malformed" ? (
          <>
            <p className="mandate-copy">
              A serial looks like <code>vch_</code> followed by at least 22 characters, or the short code{" "}
              <code>vch-ABC</code>. Nothing was looked up.
            </p>
            <p className="mandate-record">Fetched at {formatInstant(fetchedAt)}.</p>
          </>
        ) : null}

        {details ? (
          <>
            <hr className="mandate-rule" />
            <p className="mandate-record">
              <a className="mandate-link" href="/verify">
                Check another pass
              </a>
            </p>
          </>
        ) : null}

        {details && state.kind === "record" && state.payload.scope ? (
          <p className="mandate-note">
            This page is read-only. It shows the record at the time above and holds no funds, no payee list and no
            spending history.
          </p>
        ) : null}
      </section>
    </article>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="mandate-field-label">{label}</p>
      <p className="mandate-field-value">{value}</p>
    </div>
  );
}
