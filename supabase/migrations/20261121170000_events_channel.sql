-- Channel attribution (#326): which listing actually sent a caller.
--
-- `client_package`/`client_version` answer which SDK build called. They cannot answer which directory sent the caller,
-- so every row in the distribution map was unfalsifiable. The only signal collected is a `?from=<channel>` query
-- parameter, normalised in `apps/hosted/src/channel.ts`. Deliberately not collected: IP, user agent, referrer URL.
--
-- Nullable and unstyled on purpose: an absent or invalid parameter is unknown, and unknown is a real answer. It is
-- never bucketed into "direct" — a bucket would hide exactly the traffic this column exists to make visible.

alter table public.events add column if not exists channel text;

comment on column public.events.channel is
  'Listing channel from ?from=<channel>, lowercased to [a-z0-9._-]{1,32}. Null when absent or invalid; never bucketed. First valid touch wins for a session.';

-- No index. The panel query is "recent rows in a window, grouped in the application", and it is already served by
-- events_source_ts_idx (source, ts): the read filters source='real' and ts >= now() - interval. A channel index would
-- only help a future GROUP BY channel query, which this does not issue.
