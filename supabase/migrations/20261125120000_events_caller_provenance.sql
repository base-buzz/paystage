-- Caller provenance (#430): who caused a call, proven by a signed header.
--
-- The 90-day test publishes three numbers: distinct non-own callers of the gate, whether they come back, and the gap
-- to zero. Before this column, the gate could not tell our own CI, loadgen or probes from anyone else, so the number
-- the plan promises was not measurable at all.
--
-- `unknown` is the default and is NOT "external". It is the absence of a signed label: our own callers before they
-- sign, and anyone who does not send a header, are indistinguishable. The weekly report prints it as its own bucket.
--
-- The value is set by `provenanceFromHeaders` in `apps/hosted/src/telemetry.ts` from
-- `x-paystage-provenance` + `x-paystage-provenance-sig` (HMAC-SHA256, key `PAYSTAGE_PROVENANCE_KEY`). It is never
-- inferred from an IP, user agent or referrer.
--
-- Committed, not applied here: applying it needs the operator's Supabase credentials. Until it is applied the writer
-- drops this field through the existing `recordDroppedField` signal instead of silencing telemetry.

alter table public.events
  add column if not exists caller_provenance text not null default 'unknown'
  check (caller_provenance in ('own-ci', 'own-loadgen', 'own-probe', 'unknown'));

comment on column public.events.caller_provenance is
  'Who caused the call, from a signed header: own-ci | own-loadgen | own-probe | unknown. unknown is not external; it is the absence of a signed label. Never inferred from IP, user agent or referrer (#430).';

-- No new index. The weekly report filters a date window and groups in the application; the existing
-- events_ts_desc_idx already serves that scan, and a four-value column has too little selectivity to earn one.

-- The daily counter now counts by provenance as well as source. The console selects only (day, source, n) and sums
-- n per source, so adding a grouping column does not change its totals; it makes the count answer the new question.
create or replace view public.events_daily as
select date_trunc('day', ts)::date as day,
       coalesce(source, 'unknown') as source,
       count(*)::int as n,
       coalesce(caller_provenance, 'unknown') as caller_provenance
  from public.events
 group by 1, 2, 4;
