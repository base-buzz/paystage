-- Store the day's full payee set, so "new" and "gone" payees are a set difference the console can compute.
--
-- `top_payees` only keeps ten entries: enough for concentration, not enough to tell a new operator from an existing
-- one relisting outside the top ten. The console needs membership, so the collector now writes the sorted, de-duplicated
-- payee strings here (`[{...}]` of addresses). It is the whole set, not a sample: 1,324 payees on 2026-11-21 is ~61 KB
-- of JSON, and the count in `payees` stays the count of these same strings.
--
-- `default '[]'` is deliberate: rows written before this column existed keep an empty array, which the console must
-- read as "no stored set" when `payees > 0` rather than "every payee left". A genuinely empty catalogue (`payees = 0`)
-- is still an empty set and is readable.
alter table public.market_supply
  add column if not exists payee_set jsonb not null default '[]'::jsonb;

comment on column public.market_supply.payee_set is
  'Sorted de-duplicated payee strings for the run; [] on rows that predate the column. Enables new/gone payee deltas.';
