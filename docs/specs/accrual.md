# Accrual export (#474)

A period accrual over settled payments: **one row per vendor × cost centre × month**, in integer
micro-USDC, with a deterministic hash of the decision ids behind the row. It is an accounting
object, not a list of calls dressed up as an invoice.

```
period,vendor,cost_centre,currency,total_minor,count,refusals,first_ts,last_ts,evidence_hash
```

## Where it lives, and why

| Surface | Path |
|---|---|
| Aggregation (the only implementation) | `apps/console/src/lib/accrual.ts` |
| Finance mapping (the only cost-centre source) | `apps/console/src/lib/accrual-cost-centres.json` |
| Page | `GET /lab/accrual` |
| CSV | `GET /lab/accrual/export?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| JSON | `GET /lab/accrual.json?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| Ops CLI | `/work/ops/bin/accrual-export.mjs` |
| Tests | `apps/console/tests/accrual.test.ts` |

The aggregation lives in the console rather than only in an ops script because the CSV, the JSON
endpoint and the page must emit **the same rows with the same field names**. Two implementations
would drift, and a script that disagrees with a spreadsheet is worse than no export. The ops CLI
imports the console module (`node` strips the TypeScript types on import), so there is one
aggregation and three ways to reach it.

## The two columns that do not exist

`public.events` has no `vendor` column and no `cost_centre` column.

### Vendor

`vendor` is derived from `pay_to`, the address a payment was made to. The address is trimmed and
lower-cased, so `0xAB…` and `0xab…` are one vendor.

When `pay_to` is empty the row's vendor is the literal **`vendor_not_recorded`**. It is a bucket,
not a vendor. Most refusals land there because a refusal never reaches a payee and records no
`pay_to`; a settled row with no `pay_to` lands there too.

### Cost centre

**Chosen source: the explicit mapping file**, with `unassigned` as the documented default.

```json
{
  "default": "unassigned",
  "vendors": {
    "0x1b2272a2ca1792e8497a8d45fd3eb8665ae88fae": "CC-100"
  }
}
```

A vendor missing from `vendors` is exported as `unassigned`. `unassigned` means **finance has not
coded this vendor yet**; it is a real bucket, not a guessed accounting code. The export never infers
a cost centre from a payment.

**The tradeoff.** The mapping is vendor-level, so a vendor that serves two business units cannot be
split inside this export. It is a file, so changing it for the deployed endpoint is a rebuild and
deploy; the ops CLI reads it live. That is the price of not inventing an allocation. The mapping is
deliberately empty in the repository: filling it with real codes is finance's decision, not ours.

**Why not `mandates.tenant_id`.** The option is attractive and is not available honestly:

- `events` carries no mandate serial and no tenant column (the full column list is in `#474`), and the
  one `request_id` population is null on every settled row;
- `mandates` has no payee column, so it cannot say which vendor a tenant paid;
- `events.payer` is the payer address, not a tenant, and the single mandate's `agent` is a label
  (`shopping-agent-7`), not an address joinable to `pay_to`.

Measured 2026-11-27: **0 of 57 mainnet settled payments resolve to a tenant** and **57 do not**.
A `payer`/`agent` join would be a guess wearing an allocation's clothes, so this export reports the
zero instead.

## Money is integer, by construction

`amount_usdc` is a whole-USDC decimal string in the database (`numeric(18,6)`). It is parsed as a
decimal string into **micro-USDC** with `BigInt`; every sum is `BigInt`.

- `"0.002"` → `2000n`
- `"1.234567"` → `1234567n`
- a seventh decimal place, a negative amount, or an exponent (`1e-7`) is **refused**, not rounded.

A float never touches the value, so rounding is impossible by construction. `total_minor` is an
integer in micro-USDC (`82000` = `0.082000` USDC). JSON emits it as a number only after a
`Number.MAX_SAFE_INTEGER` guard.

`refusals` counts `do_not_pay` rows for that vendor/cost-centre/month. A refusal carries no amount,
so it appears as a count and never as a sum. Refusals are counted on every network: the control
working is the same fact on testnet and mainnet.

## Network scope

`settled` on Base mainnet (`eip155:8453`) is money. `settled` on any other network is counted in
the page facts (`settledOtherNetwork`) and **excluded from `total_minor`**: testnet USDC is not
spend, and adding it to mainnet USDC would overstate the month. Refusals are not filtered by
network because they carry no money.

Every mainnet settled decision is included whatever its caller provenance: each is a real payment.
Provenance stays on the per-decision record (`events.source` / `caller_provenance`, and the
`/lab/refusals/export` CSV); this accrual row is a money total, not a provenance breakdown, and it
does not suppress any real payment.

A `settled` payment on mainnet with no `amount_usdc` is counted in `count` and contributes `0`.
The export does not invent an amount. The count is visible as `settledUnpriced` on the page and in
the CLI summary.

## `evidence_hash` recipe

For each row, take the `events.id` UUIDs of the settled and refused decisions in that row:

```
sha256( [...ids].sort().join("\n") + "\n" )
```

UTF-8, lowercase hex. Sorted lexicographically by JavaScript's default string order. A duplicate id
throws instead of being de-duplicated, because a duplicate would mean one decision counted twice.

The hash proves the **set of decisions** behind the row, not their amounts; amounts are re-readable
from `events.amount_usdc` with the same ids.

## Reconciliation

For a range, over the export's underlying decisions:

```
sum(rows.total_minor) == sum(micro-USDC of mainnet settled decisions)
sum(rows.count)       == number of mainnet settled decisions
sum(rows.refusals)    == number of do_not_pay decisions
```

`evidence_ids = sum(count + refusals)` counts every id exactly once because a decision belongs to
exactly one `(period, vendor, cost_centre)` group. These equalities are asserted in
`apps/console/tests/accrual.test.ts`, and the CLI's `--format summary` prints both sides.

## Outputs

- **CSV**: stable column order above, RFC 4180 quoting, `\r\n` line endings, filename carries the
  range: `paystage-accrual-2026-11-01_to_2026-11-30.csv`.
- **JSON**: a plain array of the same rows with the same field names, so a script and a spreadsheet
  cannot disagree.
- **Page**: `/lab/accrual`, linked from `/lab/refusals` in one line. It states what a cost centre is
  and what `unassigned` means.

A read failure returns an error, never a header-only file: an unreadable events table and a quiet
month are different facts.

## How finance changes a cost centre

1. Add the vendor address (lower-case) to `vendors` in
   `apps/console/src/lib/accrual-cost-centres.json`.
2. Run the CLI to see the row change:
   `./bin/with-secret supabase node /work/ops/bin/accrual-export.mjs --from 2026-11-01 --to 2026-11-30 --format summary`
3. Rebuild and deploy the console for the page and endpoints to serve the new mapping.

## Measured snapshot, 2026-11-27 (USD whole-USDC values are decimal strings in the DB)

| Measure | Count |
|---|---|
| `events` rows | 13,752 |
| `settled` decisions, all networks | 102 |
| `settled` on Base mainnet | 57 |
| `settled` on other networks (excluded from money) | 45 |
| Mainnet settled with an amount | 41 |
| Mainnet settled with no amount (counted, 0 added) | 16 |
| `do_not_pay` decisions | 853 |
| Mainnet settled payments resolved to a tenant | **0** |
| Mainnet settled payments without a tenant | **57** |
| Mandate rows (`mandates`) | 1 (`tenant_id = paystage`) |

For November 2026 the export produces **2 rows**, total **82,000 micro-USDC** (`0.082000` USDC),
`count` sum **57**, `refusals` sum **853**, all `cost_centre = unassigned` because the mapping file
is empty. The two rows are the one paid address and `vendor_not_recorded`.

## Known limits

- No cost-centre source exists in the data; the mapping is a finance decision, and the default is a
  bucket rather than an allocation.
- The mapping is per vendor, so one vendor cannot be split across cost centres.
- No event-to-mandate link exists, so tenant resolution is 0 and is reported as 0.
- `refusals` has no rule breakdown in this row. The per-decision file at `/lab/refusals/export`
  carries `reason_codes`; one refusal can name several rules, so summing rules into this row would
  double count them.
- One currency (`USDC`) and one production network (`eip155:8453`). A second asset or chain would
  need a currency/network dimension before its totals could be added.
