-- events.payer — the column the telemetry payload has been sending since #100.
--
-- That change added `payer: event.payer ?? null` to every insert without a matching column, and
-- PostgREST rejects a row with an unknown field. The rejection was caught and logged as a warning,
-- so the effect was silent: every request returned 200 while no event was ever recorded, and the
-- site showed zero events for a day. A schema change and the code that depends on it have to land
-- together, or the failure hides in the gap.
alter table public.events
  add column if not exists payer text;

comment on column public.events.payer is
  'Settled payer address, lowercased, read from the PAYMENT-RESPONSE receipt. Null for unpaid challenges and for free-tier calls.';

-- Payer lookups are always "distinct payers in a window", so the index matches the query shape.
create index if not exists events_payer_ts_idx
  on public.events (payer, ts desc)
  where payer is not null;
