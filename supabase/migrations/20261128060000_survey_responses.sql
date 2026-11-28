-- Survey responses (#511): one question on the brand site, counted away from the table.
--
-- The question is "Would you put a team's agent spend behind a limit you can see?" with three
-- answers: yes, no, already. Keeping the count is the point; a list of answers is not. So the
-- table is write-only for the public path:
--
--   * RLS is on and there is no policy for anon/authenticated. The grants below also remove the
--     default table privileges, so the anon key cannot select, insert, update or delete a row.
--   * The only public entry points are two security-definer functions: ask_answer(...) writes one
--     answer and returns the new count; ask_count() returns the count and the first response date.
--     Both run as the migration role, which owns the table.
--
-- Rate limit: a salted hash of the caller's address, never the address. The unique index on
-- (ip_hash, answered_on) is the daily limit, so it is enforced by the database and not by a check
-- the route could skip. `answered_on` is UTC so "today" does not depend on the route's clock.
--
-- Apply through the repo's normal migration path (docs/specs/supabase-ops.md), not by hand.
-- This file contains no credentials.

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- The three answers the page offers. Anything else is a bug in the caller, not a new category.
  answer text not null check (answer in ('yes', 'no', 'already')),
  page text,
  referrer text,
  -- Lower-case SHA-256 hex of a salted address. The route never sends the address itself.
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  -- The UTC day the answer arrived. Part of the uniqueness key, so one address gets one row a day.
  answered_on date not null default ((now() at time zone 'utc')::date)
);

-- One answer per address per UTC day. This is the rate limit; it is not advisory.
create unique index if not exists survey_responses_ip_day_idx
  on public.survey_responses (ip_hash, answered_on);

-- The count is a full scan on this small table; the index keeps the older rollups cheap too.
create index if not exists survey_responses_created_at_idx
  on public.survey_responses (created_at);

alter table public.survey_responses enable row level security;
-- Supabase's default grants give anon/authenticated table access. Remove them explicitly: the table
-- itself must not be readable even though the count is public.
revoke all on public.survey_responses from anon, authenticated;

comment on table public.survey_responses is
  'Survey answers (#511). Write-only for the public path: no RLS policy for anon; ask_answer() inserts and returns the count, ask_count() reads the count. ip_hash is salted and never the address.';

comment on column public.survey_responses.ip_hash is
  'SHA-256(salt || ":" || address), lower-case hex. The address is never stored; the unique (ip_hash, answered_on) index is the one-answer-per-day limit.';

-- Insert one answer and return the count in the same statement.
--
-- The function is security definer because the table is deliberately unreadable to anon. Its
-- search_path is pinned so a caller cannot shadow `survey_responses` with a relation in another
-- schema. A duplicate (same ip_hash, same UTC day) inserts nothing and comes back stored = false.
create or replace function public.ask_answer(
  p_answer text,
  p_page text,
  p_referrer text,
  p_ip_hash text
)
returns table (stored boolean, response_count bigint, opened_on date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stored boolean := false;
  v_count bigint;
  v_opened date;
begin
  if p_answer is null or p_answer not in ('yes', 'no', 'already') then
    raise exception 'answer must be yes, no or already' using errcode = '22023';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ip_hash must be a lower-case sha-256 hex string' using errcode = '22023';
  end if;

  insert into public.survey_responses (answer, page, referrer, ip_hash)
  values (
    p_answer,
    nullif(left(coalesce(p_page, ''), 500), ''),
    nullif(left(coalesce(p_referrer, ''), 500), ''),
    p_ip_hash
  )
  on conflict (ip_hash, answered_on) do nothing;

  -- FOUND is false when the ON CONFLICT clause skipped the row: the same address already answered today.
  v_stored := found;

  select count(*), min(created_at)::date
    into v_count, v_opened
    from public.survey_responses;

  return query select v_stored, v_count, v_opened;
end
$$;

revoke all on function public.ask_answer(text, text, text, text) from public;
grant execute on function public.ask_answer(text, text, text, text) to anon, authenticated;

comment on function public.ask_answer(text, text, text, text) is
  'Insert one survey answer and return (stored, response_count, opened_on). The table is not readable by anon; this function is the write path and the count read in one call.';

-- Read the count without exposing a row. Always returns exactly one row; `opened_on` is null while
-- the table has no answers, and the page keeps its own opening date for that case.
create or replace function public.ask_count()
returns table (response_count bigint, opened_on date)
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*), min(created_at)::date
    from public.survey_responses;
$$;

revoke all on function public.ask_count() from public;
grant execute on function public.ask_count() to anon, authenticated;

comment on function public.ask_count() is
  'Return the survey response count and the first response date without exposing rows. One row always; opened_on is null for an empty table.';
