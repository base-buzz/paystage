import { PASS_TOKENS } from "@/lib/pass-tokens";

/**
 * The pass's own head: mark, wordmark and status chip.
 *
 * `/m/:serial`, `/verify` and `/v/:serial` all render this, so the state a counterparty sees on one page is the same
 * drawing and the same chip as on the other two. It was a local component of `MandateCard` until the counterparty
 * pages needed it; the markup and classes are unchanged.
 *
 * The pass face has four marks and no `unknown` one, so the states it never has use the empty-lock mark: a fifth
 * drawing is exactly the drift this component removes.
 */
export function markFor(status: string): "active" | "revoked" | "expired" {
  if (status === "active") return "active";
  if (status === "revoked") return "revoked";
  return "expired";
}

/**
 * State treatment mirrors the pass: a revoked, expired or unknown mandate has no colour left in it, because a page
 * that stays blue while the card greys out is two answers to the same question. The pass greys its plate; this greys
 * the tint. Same rule, one token — and the value comes from `pass-tokens.json`, so the page cannot drift from the
 * renderer.
 */
export function stateTint(status: string): string {
  return status === "revoked" || status === "expired" || status === "unknown"
    ? PASS_TOKENS.state.deadPlate
    : PASS_TOKENS.posterTints[0];
}

export function StatusChip({ status }: { status: string }) {
  return (
    <span className="mandate-chip" data-dead={status === "active" ? "false" : "true"}>
      {status}
    </span>
  );
}

/**
 * The two non-live states share the dead treatment on purpose: `unknown` is an answer, not an error, and it must look
 * like one. A reader who sees red for revoked and a soft grey "not found" for unknown has been given two policies.
 */
export function PassHead({ status }: { status: string }) {
  return (
    <header className="mandate-poster">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mandate-mark" src={`/pass/mark-${markFor(status)}.svg`} alt="" width={100} height={100} />
      <div className="mandate-brand">
        <span className="mandate-wordmark">vouchguard</span>
        <span className="mandate-vouched">vouched by PayStage</span>
      </div>
      <StatusChip status={status} />
    </header>
  );
}
