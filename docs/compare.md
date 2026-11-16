# How this compares

Four things in this lane are worth naming, and the honest version of each includes what it has that we do not. All four
links were checked on 2026-11-16; none of the descriptions below is a claim about their pricing or reliability.

## The short version

| | What it does | What it does that we do not | What we do that it does not |
|---|---|---|---|
| **SML x402 Agent Wallet** | payer-side leash + seller pre-flight + hash-chained log | a **hash-chained log** — tamper-evident history, where our receipts are individually signed but not chained | rail-neutral policy + cited deny list + OFAC screening in one verdict |
| **merona.io** | wash-volume and listing-provenance screening on Base | **seller-side screening** and market-level analysis: they watch the ecosystem, not one payment | the pre-sign decision inside the agent's own loop, with a receipt |
| **Agent Wormhole x402 Guard** | a wallet-native payee screen | it sits **inside the wallet**, so it cannot be bypassed by an agent | we work before any wallet, across facilitators, and explain the refusal |
| **TWZRD gate** | a gate for x402 payment flows | a **hosted dashboard** you can show a team | open source (MIT), local evaluation, no account |
| **x402 Seller Probe** (`probe.x402jp.com`) | probes sellers and scores whether they actually deliver | a **probe fleet** — they test endpoints continuously | we judge the payment you are about to make, without needing the seller's cooperation |

## What each row means in practice

**SML** is the closest to us: a leash on the payer plus a pre-flight and a log. Two differences matter. Their log is
hash-chained, which is genuinely better than independent receipts for *proving nothing was removed* — we should adopt
that (it is on the backlog). Our advantage is the data: a cited drainer list, OFAC screening, and a verdict that names
the rule.

**merona** answers a different question — *is this seller's volume real* — from the outside. That is complementary
rather than competing: a buyer could use both.

**Agent Wormhole** puts the check in the wallet. That is structurally stronger than an advisory call: it cannot be
skipped. It is also tied to one wallet, while we evaluate any x402 challenge regardless of who signs.

**TWZRD** is the product-shaped version: a dashboard and a hosted gate. We are the opposite bet — MIT, local, no
account — which is a real trade: easier to audit, harder to sell.

**x402 Seller Probe** measures delivery by probing. We cannot do that without becoming a probe fleet, which is why the
ledger says to build *on* their scores rather than compete with them.

## Honest gaps in this page

- The **SML** row is reconstructed from our own ledger note. Its source link was lost in the 2026-11-12 restore (a
  macOS copy replaced the ledger with a five-day-old snapshot) and has not been re-verified. Treat the description as
  `[assumed]` until it is.
- Descriptions of the other four are from their own pages at the time of checking; none has been tested against a
  payment we control.
- If any of them does something listed here as our advantage, this page is wrong and should be corrected — that is the
  same rule as `LIMITS.md`.

## Related

- [`LIMITS.md`](../LIMITS.md) — what we cannot catch, in more detail than a table can hold
- [`docs/glossary.md`](glossary.md) — every term used above
