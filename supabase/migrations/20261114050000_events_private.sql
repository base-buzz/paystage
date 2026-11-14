-- The events table was readable with the publishable key, including its private columns.
--
-- `events_public_select` was a `using(true)` SELECT policy written on 2026-11-01, when events held
-- only tool/decision/network columns and publishing them was the point. It later gained request_id,
-- payer, tx_hash and error_class — and the policy did not change. The publishable key ships to the
-- browser by design, so every one of those columns was readable by anyone who opened devtools.
--
-- Found on 2026-11-14 while auditing the new live feed, which had been built on the premise that the
-- safest way to not leak a column is for it to not exist in the public table. That premise was true
-- of events_feed and false of the table it mirrors.
--
-- The public read surface is `events_feed`: six columns, groomed hourly. This table is the record.
drop policy if exists events_public_select on public.events;
revoke all on public.events from anon, authenticated;

-- RLS was already blocking writes (no INSERT policy), so the INSERT/DELETE/TRUNCATE/TRIGGER grants
-- that Supabase's default privileges had created were never exercised. Removed anyway: an unused
-- grant is a future incident waiting for one policy mistake.
grant select, insert, update, delete on public.events to service_role;
