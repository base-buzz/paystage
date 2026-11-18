-- Daily probe results, so the trend is queryable rather than buried in dated JSON files.
--
-- Two probes write here:
--   discovery  — how findable we are for buyer-style searches (bin/agent-discovery-probe.mjs)
--   decision   — what an agent actually decides when asked to pay (bin/agent-decision-run.mjs)
--
-- One row per probe per run. `payload` keeps the whole snapshot verbatim so a change in the probe's
-- shape never needs a migration; `summary` is the small object the /lab page renders.

create table if not exists public.probe_runs (
  id uuid primary key default gen_random_uuid(),
  probe text not null check (probe in ('discovery', 'decision')),
  run_at timestamptz not null default now(),
  -- the one number that matters per probe: present/total for discovery, ready-decisions/agents for decision
  headline text,
  summary jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists probe_runs_probe_run_at_idx on public.probe_runs (probe, run_at desc);

-- Read path is SERVER ONLY. RLS is enabled with no policy on purpose: the anon key must read zero rows.
-- The only permitted reader is `apps/console/src/app/lab/page.tsx`, through `@/lib/supabase#selectRows`,
-- which uses SUPABASE_SERVICE_ROLE_KEY. If any client component or anon-key API route ever reads this
-- table it returns an empty set rather than an error, and the page would show "never run" — which reads as
-- a truthful statement about the probe, so the failure would be invisible. Keep reads server-side, and keep
-- `payload` out of any client-serialised prop.
alter table public.probe_runs enable row level security;

-- Retention: one row per probe per day, `payload` is the whole snapshot (a few kB for discovery, larger
-- once a decision run stores transcripts). A year is ~730 rows and single-digit MB, so no pruning is needed
-- now; revisit if the decision payload grows past ~50 kB, or if a per-agent transcript is stored per run.
