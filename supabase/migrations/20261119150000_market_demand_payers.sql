-- Payer classification, because a transfer count is not demand.
--
-- The 2026-11-19 research found three wallets that each spent exactly 12.4630 USDC in ~35 minutes and one paying every ~35 seconds for five hours: budget spend-downs and loops, not
-- customers. Storing the split lets the page say "likely-test" instead of letting a demo loop read as adoption.

alter table public.market_demand
  add column if not exists payers jsonb not null default '[]'::jsonb,
  add column if not exists likely_test_payers integer not null default 0;

comment on column public.market_demand.payers is 'per-payer {payer, transfers, payees, value_usdc, span_hours, transfers_per_hour, class}; class is likely-test when >10 tx/hour or >=100 tx';
comment on column public.market_demand.likely_test_payers is 'count of payers classified likely-test in this window';
