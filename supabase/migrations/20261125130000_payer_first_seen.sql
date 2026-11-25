-- Payer first seen (#409): the smallest fact that lets a decision vary with payer age.
--
-- One row per **salted payer key** and the first instant this deployment saw it. There is no
-- address column, no payee/merchant column, no amount, no last_seen and no count. A join table that
-- could reconstruct an address graph is the thing this table exists to avoid.
--
-- The key is HMAC-SHA-256(salt, "paystage.payer-first-seen.v1\0" + payer), derived by
-- `packages/preflight/src/payer-first-seen.ts`. The salt is a deployment secret supplied by the
-- operator; it is deliberately not in this file. Reading this table does not reveal an address,
-- but anyone holding the salt and an address can test whether that payer is present — the key is
-- pseudonymous to a reader, not unlinkable to the service.
--
-- Write path is server-only: RLS is enabled with no policy. The host reads and inserts through
-- `PayerFirstSeenPersistence`; the evaluator never imports a database client.
--
-- Apply through the repo's normal migration path, not by hand. This file contains no credentials.
-- A production salt value is an operator decision and is not created here.

create table if not exists public.payer_first_seen (
  -- Lowercase 64-hex HMAC output. The payer address itself is never a column.
  payer_key text primary key check (payer_key ~ '^[0-9a-f]{64}$'),
  -- When the salted key was first seen. First sighting only: an insert must never move it.
  first_seen timestamptz not null
);

alter table public.payer_first_seen enable row level security;

comment on table public.payer_first_seen is
  'Salted payer first-seen (#409): payer_key + first_seen only. No address, no payee link, no history. Server-side only (RLS enabled, no policy).';
