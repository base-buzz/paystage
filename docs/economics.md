# What a paid call costs us

One line, because this is the number that decides whether per-call pricing is viable at all:

> **A call sells for $0.002000 and costs about $0.000650 to settle on Base — 32% of revenue, before any facilitator fee.**
> Measured 2026-11-27: gas price **0.006 gwei**, ETH **$1,665.44**, **65,000** gas for an EIP-3009 transfer
> (`$0.000650` = 65,000 × 0.006 gwei × $1,665.44).

## Why it is written down

Because a price that is 32% gas has an expiry date that nobody wrote on it: at **0.0092 gwei** — one and a half times
today's price, which Base reaches on an ordinary busy afternoon — gas passes **50% of revenue**. Below that line,
per-call selling works; above it, every call is a donation with extra steps. The number moves with ETH, not with us.

`scripts/check-unit-economics.mjs` recomputes it from the constants in this table and fails the build when gas exceeds
**50%** of the price at the gas price named here. It also fails when the prose above stops matching the constants, so
the sentence and the arithmetic cannot drift apart.

## The constants

| constant | value | where it comes from |
|---|---|---|
| `PRICE_ATOMIC` | `2000` (USDC, 6 decimals → $0.002) | the `accepts[]` entry our route returns |
| `GAS_UNITS` | `65,000` | one EIP-3009 `transferWithAuthorization` on Base |
| `GAS_PRICE_GWEI` | `0.006` | `eth_gasPrice` on Base, 2026-11-27 |
| `ETH_USD` | `1665.44` | spot at the same moment |

## What is *not* in it

- **Facilitator fees.** None of the six publishes a fee (`docs/research/facilitators-2026-11-27.md`), so the margin here is
  an upper bound, not a promise.
- **Batched settlement.** Under `batch-settlement` the per-call gas stops being the unit of cost and this page stops
  describing the route; that change would be a new row, not an edit here.
- **Our own traffic.** Every settled payment to date is ours (`docs/economics.md` is about the rail, not demand); see the
  provenance labels on `/lab` for what the numbers include.
