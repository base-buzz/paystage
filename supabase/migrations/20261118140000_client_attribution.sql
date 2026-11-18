-- Install-to-call attribution (#52).
--
-- The question npm cannot answer: a download is not a call, and a call is not a user. These two columns record the
-- **SDK build** that made a request, which turns "4,139 weekly downloads" into "which installed version is actually
-- being invoked". Deliberately not recorded: IP, user agent string, or anything else that identifies a person.
--
-- Nullable on purpose: a caller that does not send the header is unknown, and "unknown" is a real answer that should
-- stay distinguishable from a caller we mislabelled.

alter table public.events add column if not exists client_package text;
alter table public.events add column if not exists client_version text;

comment on column public.events.client_package is
  'The @paystage/* package that made the call, from x-paystage-client or the user agent. Null when not sent.';
comment on column public.events.client_version is
  'The package version that made the call. Attribution by build, never by caller identity.';

-- The query this exists for: calls grouped by installed version, over a window.
create index if not exists events_client_version_created_idx
  on public.events (client_version, ts desc);
