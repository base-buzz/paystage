-- The supply-side inventory becomes a fifth probe kind.
--
-- It is not a probe of our own surfaces; it is a measurement of the market our policies have to express. Keeping it in the same table
-- means /lab can show it beside the others without a second read path.
alter table public.probe_runs drop constraint if exists probe_runs_probe_check;
alter table public.probe_runs
  add constraint probe_runs_probe_check check (probe in ('discovery', 'decision', 'outreach', 'clients', 'supply'));
