-- Measured latency, so the page never has to assert a number it can read.
--
-- The site claimed "~40 ms" for an end-to-end call. An adversarial review measured p50 185 ms. Nothing
-- was lying; the figure had simply never been re-measured after it was written. A view makes the number
-- a query, and a query cannot go stale while it is being displayed.
create or replace view public.events_latency_7d as
select count(*)::int as n,
       percentile_cont(0.5) within group (order by latency_ms)::int as p50,
       percentile_cont(0.9) within group (order by latency_ms)::int as p90
  from public.events
 where latency_ms is not null and latency_ms > 0 and ts > now() - interval '7 days';

revoke all on public.events_latency_7d from anon, authenticated;
grant select on public.events_latency_7d to service_role;
