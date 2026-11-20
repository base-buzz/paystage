# First payer — what we record, publish and refuse to say

Written **before** an external payer exists, so the policy is not improvised at the moment of highest
temptation to call one payer "a customer". Reviewed 2026-11-20.

## What we record

Exactly three fields, all already on the `events` row for a settled payment:

| field | what it is |
|---|---|
| `payer` | the on-chain address that settled |
| `tx_hash` | the settlement transaction |
| `ts` | when it settled |

**Not recorded, and not to be added for this purpose:** source IP, user agent, referrer, session or
cookie, email, any name, any other event of that address. If a future need wants one of those, that is a
separate decision with its own review — it is not an extension of this one.

Detection is by **address**, not by the `source` header: the header is caller-set, so an agent that omits
it would read as "real", while comparing against the wallets we operate cannot be spoofed that way.

## The query, verbatim

`bin/first-payer-alert.mjs` runs, against the hosted Supabase project:

```
${SUPABASE}/rest/v1/events?select=payer,tx_hash,ts&decision=eq.settled&order=ts.asc
```

then filters rows whose `payer` (lowercased) is not in `OURS` — currently `LOADGEN_KEY_1`
(`0xc64a71e1…`, the paid canary) and `PAYSTAGE_E2E_SEPOLIA_KEY` (`0x73fb4a47…`, the paid-e2e CI job).
The first surviving row is the first external payer.

**A recorded "first payer" that is one of ours is not a first payer.** Found 2026-11-20: the state file
named `0x73fb4a47…`, which is our own E2E wallet — and because `alerted` short-circuits the alert, the
real one would have printed "already alerted" and nobody would have been told. The script now validates
the record rather than trusting it (`--check-state`, exit 12 when invalid) and re-arms.

## What we publish

- **the transaction hash, the date, the amount, the tool and the verdict** — those are public chain facts and they are ours
- **not the payer address, by default.** An address is a pseudonym with a history attached; publishing it invites somebody else to deanonymise that payer with our help. A one-line ask
  ("we would like to credit the first payer — may we name the address?") is the only route to naming it, and only if the answer is yes
- once, as an event, never as a running count that reads like a customer list

## What we refuse to say

- **never "customer"** — one settled call is one settled call
- **never "revenue"** — we have no revenue, only a payment someone chose to make
- **never "users"** in the plural on the strength of one address
- no aggregation by address, no inference about who they are, no enrichment from third parties

The honest sentence is: *"the first payment from a wallet we do not operate settled on <date>, tx <hash>."*
Anything beyond that needs its own evidence.

## Who reviews

- **Reviewer role:** the operator. The role, not a person's name, so this document survives a handover.
- **Who may approve an exception:** the operator only, and only for publishing something this document
  refuses. An exception is recorded here, in the same commit as the copy it permits, with the address and
  the reason.
- **Who may change this document:** any session may propose; the holder of the push identity applies it.
  The rule follows `AGENTS.md` 14 — one push identity.

## What happens on the event

1. `bin/first-payer-alert.mjs` exits 10 and writes `docs/state/first-payer.json` (once).
2. The alert appends `FIRST-PAYER <address> <tx>` to the canary feed and files an escalation, so it reaches
   the surface someone reads.
3. A human reads this file **before** writing anything public.
4. Publishing is a normal post — no approval needed by rule 16 — but the copy is checked against the
   "refuse to say" list above, and the transaction is linked so a reader can verify it.
