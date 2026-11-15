-- Daily counts, because the API caps a response at 1000 rows.
--
-- The lander charts requests per day from `events`. Bucketing 30 days of rows in the client failed
-- twice: PostgREST truncates at the project's db-max-rows (1000), and without an explicit order those
-- 1000 rows were the *oldest* — so recent days charted as zero, which reads exactly like a collapse in
-- traffic. Counting in Postgres makes the question "30 rows" instead of "however many fit".
create or replace view public.events_daily as
select date_trunc('day', ts)::date as day,
       coalesce(source, 'unknown') as source,
       count(*)::int as n
  from public.events
 group by 1, 2;

-- Public read only serves the feed, not this. The console queries it with the service key.
revoke all on public.events_daily from anon, authenticated;
grant select on public.events_daily to service_role;
