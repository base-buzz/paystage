-- events_feed is a rolling window, not a record.
--
-- The live feed on the lander seeds from this table on every page load. Left alone it grows without
-- limit: the hourly canary alone is 24 rows a day, and a load test or a retry loop can add thousands
-- in a minute — which turns "show the last few calls" into a slow query and a heavy first paint.
--
-- Two rules, both enforced in the database so no external job has to remember them:
--   1. age — seven days is enough to see a pattern; older rows serve nobody
--   2. cap — never more than 2000 rows, whatever the traffic did
--
-- Verified on 2026-11-14: a row dated ten days ago was removed by the function, and the schedule is
-- `groom-events-feed` at 17 minutes past every hour.
create extension if not exists pg_cron;

create or replace function public.groom_events_feed() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.events_feed where created_at < now() - interval '7 days';
  delete from public.events_feed
   where id in (
     select id from public.events_feed
      order by created_at desc
      offset 2000
   );
end $$;

select cron.unschedule('groom-events-feed')
 where exists (select 1 from cron.job where jobname = 'groom-events-feed');
select cron.schedule('groom-events-feed', '17 * * * *', $$select public.groom_events_feed()$$);
