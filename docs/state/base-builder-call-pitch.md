# Base Builder Call pitch — PayStage

Draft 2026-11-23. Everything above **Source notes** is the pasteable pitch. Every figure below is
dated and tied to a stored measurement; the notes are not part of the pitch text.

---

## PayStage — an independent spend gate for agents paying on Base

Agents are starting to pay per request over x402. The protocol makes the payment easy and leaves the
decision to the caller: a wallet checks a signature, not whether the request should be paid.

PayStage sits between the agent and the 402 it is about to sign. `guardFetch` decodes the challenge,
checks the payee, amount, asset, network and the caller's policy, and returns `pay`, `review`, or
`do_not_pay` with the rule that fired and a receipt. It holds no keys and no funds — the agent remains
the only signer — and a refusal returns the seller's own 402 unsigned, so there is nothing to revoke.

The gap is real and measurable. In a 100-host sample on 2026-11-22, 56 hosts served a checkable 402,
and **2 of those 56 named a payee different from the one recorded in the catalogue for the same URL**.
One of the two also asked **4.5× the advertised price** (11,000 → 50,000 atomic USDC). An agent paying
from the directory would have sent money to the wrong address. Meanwhile the top of the market is not
broken — 97 of the top 100 entries by observed 30-day calls returned a correct 402 on 2026-11-23 — which
is exactly why drift is the failure worth catching: the healthy majority makes the exceptions invisible.

Concentration makes that failure larger than one endpoint. The top 8 hosts hold **92.3% of the 30-day
calls** across the top 100 listings (2026-11-23), and 33 hosts carry all 100 entries. Those calls are
observed calls, not settled payments, but the direction is clear: a wrong payee or a mispriced ask on a
handful of hosts reaches most of the demand.

The gate is a public good because it is third-party infrastructure: no listings, no wallet, no custody,
no position in the payment it judges. The evaluator is MIT and readable, the first 1,000 hosted calls a day
need no account, and calls after that are $0.002 each — the same order as the calls around it. Every
verdict carries a reason code a caller can audit. A buyer should not have to
trust the seller to check the seller, and an honest seller benefits when the check is public.

---

## Source notes (not part of the pitch)

| Claim in the pitch | Figure | Date | Source |
|---|---|---|---|
| 100-host sample; hosts serving a checkable 402 | 56 of 100 | 2026-11-22T08:19Z | `/work/ops/docs/state/self-checkable-2026-11-22.md`, headline and Results |
| Live payees differing from the catalogue | 2 of 56 | 2026-11-22 | same file, “The catalogue is not a substitute for the live challenge” |
| Price multiple on the drifted payee | 4.5× (11,000 → 50,000 atomic) | 2026-11-22 | same file, same table |
| Top-100 entries returning a correct 402 | 97 of 100 | 2026-11-23 | `/work/ops/docs/research/checked-sellers.md`, Result table |
| Top 8 hosts' share of top-100 30-day calls | 92.3% | 2026-11-23 | `/work/ops/docs/research/top-hosts.md`, “What actually separates”; arithmetic from its 33-host table (3,017,055 / 3,269,089) |
| Hosts carrying the top 100 entries | 33 | 2026-11-23 | same file, Method and denominator |
| 30-day calls are calls, not settlements or revenue | — | 2026-11-23 | same file, “What this data cannot support”; checked-sellers.md repeats it |
| Deny-list coverage | 229 unique addresses = 17.3% of 1,321 catalogue payees | 2026-11-21/22 | `docs/state/measurements.json`, `supply.*` entries |
| Product behaviour (`pay` / `review` / `do_not_pay`, reasons, no keys or custody, unsigned refusal) | — | README read 2026-11-23 | `README.md`, “Where the money does not move” and “What decides” |
| MIT, 1,000 free hosted calls/day, $0.002 per call after | — | README read 2026-11-23 | `README.md`, “The hosted endpoint” paragraph |

### Deliberately not in the pitch

- No claim of uniqueness. The pitch says what the gate does and what the measurements show; it does
  not say no other product checks a payee.
- No personal names and no request to contact anyone.
- No revenue, user, or demand claim. `l30DaysTotalCalls` is calls; the 4.5× is an advertised/challenged
  amount, not a settled payment.
- No claim that the 56-host or top-100 samples describe the whole catalogue. Both are samples with
  their denominators stated.
