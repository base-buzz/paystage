# Why preflight runs before signing, not after settlement

An x402 payment is a signature over an authorization. Once the facilitator
settles it, the funds have moved and there is no cancel step. PayStage therefore
evaluates the proposed payment *before* the agent signs.

## The window that matters

A wallet enforces signing; it does not enforce intent. There is no approval step
between "the agent decided to pay" and "the payment is irreversible" —
[`apps/console/src/app/page.tsx`](../apps/console/src/app/page.tsx) states this
directly.

Settlement is the wrong place to check for the same reason. The hosted layer's
own SLO says settlement "is not idempotent at this layer; it belongs to the x402
flow" — [SLO.md](../apps/hosted/SLO.md). A verdict computed after settlement
describes money already spent.

## What a pre-signing gate can still change

A verdict returned before the signature is still actionable. `evaluatePayment`
returns `pay`, `review`, or `do_not_pay`, with the rule that fired —
[`packages/preflight/src/evaluate.ts`](../packages/preflight/src/evaluate.ts).
`review` routes to a human above `require_human_above`; `do_not_pay` stops the
call. Neither outcome exists once settlement has occurred.

The check also has to be local. The hosted evaluate endpoint is documented as
"read-only and idempotent — it evaluates, it does not settle"
([SLO.md](../apps/hosted/SLO.md)), so a slow or unreachable dependency cannot
turn a deny into a pay: the documented behavior on timeout is to fail closed.

## Deny-listing only works before the money moves

Rule 7a in `evaluate.ts` checks the curated drainer list *before* the
`unknown_payee` review path, so a listed payee returns `do_not_pay`. Those
entries carry a public citation each, retrieved on a stated date — see
[`packages/preflight/KNOWN_DRAINERS.md`](../packages/preflight/KNOWN_DRAINERS.md)
(e.g. the MEW darklist and 0xCERT IOC feeds, both retrieved 2026-11-02 NZDT).
A post-settlement check could name the drainer, but not recover the payment.

## What this page does not claim

It does not claim preflight is bypass-proof; [`SECURITY.md`](../SECURITY.md)
treats a bypass as a bug, which means one is possible. It does not claim the
drainer list is complete — KNOWN_DRAINERS.md says precision is preferred over
recall. It does not claim any evaluation has been run against a live adversary
in this document.
