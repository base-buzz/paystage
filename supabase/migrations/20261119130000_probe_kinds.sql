-- Widen the probe kinds the table accepts.
--
-- The check constraint was written for the first two probes and every new one has to add its name; `clients` is the
-- soak-test harness and `outreach` is the daily contact cycle. Left as a fixed list rather than dropping the constraint,
-- because an unknown probe name is a typo worth failing on.
alter table public.probe_runs drop constraint if exists probe_runs_probe_check;
alter table public.probe_runs
  add constraint probe_runs_probe_check check (probe in ('discovery', 'decision', 'outreach', 'clients'));
