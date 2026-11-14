-- The base DDL for the live feed, which existed only in the live database.
--
-- The feature was created through the Management API on 2026-11-14 and only its *retention* rule was
-- ever committed, so `grep -r events_feed supabase/` found the groomer and nothing it grooms. A fresh
-- database could not reproduce the feed at all. Written from the live schema, verified against it.
create table if not exists public.events_feed (
  id uuid primary key default gen_random_uuid(),
  tool text not null,
  decision text not null,
  source text not null,
  network text not null,
  created_at timestamptz not null default now()
);

create index if not exists events_feed_created_idx on public.events_feed (created_at desc);

-- The public read surface. Six columns, no request_id, no payer, no error_class — because Realtime
-- publishes whole row images, so the only way to not leak a column is for it to not exist here.
alter table public.events_feed enable row level security;
drop policy if exists events_feed_read on public.events_feed;
create policy events_feed_read on public.events_feed for select using (true);

-- Mirror every event. security definer because the API role has no write grant on the feed.
create or replace function public.mirror_event_to_feed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tool is null or new.decision is null then return new; end if;
  insert into public.events_feed (tool, decision, source, network, created_at)
  values (new.tool, new.decision, coalesce(new.source, 'unknown'), coalesce(new.network, 'unknown'), new.ts);
  return new;
end $$;

drop trigger if exists events_to_feed on public.events;
create trigger events_to_feed after insert on public.events
  for each row execute function public.mirror_event_to_feed();

-- Realtime needs the table in the publication, or the browser subscribes to silence.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'events_feed'
  ) then
    alter publication supabase_realtime add table public.events_feed;
  end if;
end $$;
