-- PayStage telemetry: events + incidents + issue flag views.
--
-- Rules:
--   * Real metrics queries MUST filter source='real'.
--   * Synthetic queries are always labelled in the UI.
--   * 'test' is for local/dev and never appears in headline metrics.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  source text not null check (source in ('real','synthetic','test')),
  tool text not null,
  decision text not null,
  reason_codes text[] not null default '{}',
  network text not null,
  latency_ms int,
  amount_usdc numeric(18,6),
  pay_to text,
  tx_hash text,
  request_id text,
  facilitator_status text,
  error_class text
);

create index if not exists events_ts_desc_idx on public.events (ts desc);
create index if not exists events_source_ts_idx on public.events (source, ts);
create index if not exists events_error_class_ts_idx on public.events (error_class, ts);

-- ---------------------------------------------------------------------------
-- incidents (public status feed)
-- ---------------------------------------------------------------------------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  severity text not null check (severity in ('info','warning','critical')),
  title text not null,
  summary text not null,
  status text not null check (status in ('open','monitoring','resolved')),
  public boolean not null default true
);

create index if not exists incidents_opened_at_desc_idx on public.incidents (opened_at desc);
create index if not exists incidents_public_status_idx on public.incidents (public, status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.incidents enable row level security;

-- Public dashboard reads events (all rows). Writes only via service role
-- (service role bypasses RLS; no insert/update/delete policy for anon/auth).
drop policy if exists events_public_select on public.events;
create policy events_public_select on public.events
  for select
  to anon, authenticated
  using (true);

-- Public status feed reads only public incidents.
drop policy if exists incidents_public_select on public.incidents;
create policy incidents_public_select on public.incidents
  for select
  to anon, authenticated
  using (public = true);

-- ---------------------------------------------------------------------------
-- Issue flag views
--
-- Thresholds (constants):
--   * failed_settlements: last 24h, facilitator_status ilike '%fail%'
--     OR error_class = 'settlement_failed'
--   * facilitator_errors: last 24h, error_class = 'facilitator_error'
--   * latency_spikes: last 24h, latency_ms > 5000
--   * abnormal_block_rate: > 30 events/min in any 5-min window in last hour
--     (source != 'test')
--   * treasury_drift: Phase 1 stub — returns zero rows until balances wired.
-- ---------------------------------------------------------------------------

-- failed_settlements
create or replace view public.issue_flags_failed_settlements as
select
  'failed_settlements'::text as flag,
  count(*)::int as count,
  max(ts) as last_seen
from public.events
where ts > now() - interval '24 hours'
  and (
    facilitator_status ilike '%fail%'
    or error_class = 'settlement_failed'
  );

-- facilitator_errors
create or replace view public.issue_flags_facilitator_errors as
select
  'facilitator_errors'::text as flag,
  count(*)::int as count,
  max(ts) as last_seen
from public.events
where ts > now() - interval '24 hours'
  and error_class = 'facilitator_error';

-- latency_spikes (threshold: latency_ms > 5000)
create or replace view public.issue_flags_latency_spikes as
select
  'latency_spikes'::text as flag,
  count(*)::int as count,
  max(ts) as last_seen
from public.events
where ts > now() - interval '24 hours'
  and latency_ms is not null
  and latency_ms > 5000;

-- abnormal_block_rate: any 5-min bucket in last hour with > 30 events/min
-- (i.e. > 150 events in a 5-min window), excluding source='test'.
create or replace view public.issue_flags_abnormal_block_rate as
with buckets as (
  select
    date_trunc('hour', ts)
      + (floor(extract(minute from ts) / 5) * interval '5 minutes') as bucket,
    count(*)::int as events_in_bucket
  from public.events
  where ts > now() - interval '1 hour'
    and source <> 'test'
  group by 1
)
select
  'abnormal_block_rate'::text as flag,
  coalesce(max(events_in_bucket), 0)::int as max_events_in_5min,
  case
    when coalesce(max(events_in_bucket), 0) > 150 then true
    else false
  end as triggered
from buckets;

-- treasury_drift: Phase 1 stub. Returns zero rows until treasury balances
-- are wired in. When wired, compare sum(amount_usdc) for source='real'
-- against expected on-chain treasury balance and emit a row on drift.
create or replace view public.issue_flags_treasury_drift as
select
  'treasury_drift'::text as flag,
  null::numeric as drift_usdc,
  null::timestamptz as last_seen
where false;

-- Unified issue_flags view: one row per flag with triggered boolean.
create or replace view public.issue_flags as
with
  fs as (select * from public.issue_flags_failed_settlements),
  fe as (select * from public.issue_flags_facilitator_errors),
  ls as (select * from public.issue_flags_latency_spikes),
  ab as (select * from public.issue_flags_abnormal_block_rate),
  td as (select * from public.issue_flags_treasury_drift)
select
  'failed_settlements'::text as flag,
  (coalesce((select count from fs), 0) > 0) as triggered,
  coalesce((select count from fs), 0)::int as count,
  (select last_seen from fs) as last_seen
union all
select
  'facilitator_errors'::text,
  (coalesce((select count from fe), 0) > 0),
  coalesce((select count from fe), 0)::int,
  (select last_seen from fe)
union all
select
  'latency_spikes'::text,
  (coalesce((select count from ls), 0) > 0),
  coalesce((select count from ls), 0)::int,
  (select last_seen from ls)
union all
select
  'abnormal_block_rate'::text,
  coalesce((select triggered from ab), false),
  coalesce((select max_events_in_5min from ab), 0)::int,
  null::timestamptz
union all
select
  'treasury_drift'::text,
  false,
  0,
  null::timestamptz;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on public.issue_flags to anon, authenticated;
grant select on public.issue_flags_failed_settlements to anon, authenticated;
grant select on public.issue_flags_facilitator_errors to anon, authenticated;
grant select on public.issue_flags_latency_spikes to anon, authenticated;
grant select on public.issue_flags_abnormal_block_rate to anon, authenticated;
grant select on public.issue_flags_treasury_drift to anon, authenticated;
