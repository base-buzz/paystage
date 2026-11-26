-- Mandates (#453): the table under `GET /v1/mandate/:serial` and `/m/:serial`.
--
-- One row per serial. The row is a *projection* of the signed envelope, not a replacement for it:
-- `envelope` holds the exact object `@paystage/mandate.verify()` accepted, signature included, because
-- the signature is what makes the record an authority rather than a note in a database. The scalar
-- columns exist so the public read can answer without parsing the envelope, and so RLS can key on
-- `tenant_id` without trusting payload JSON.
--
-- Two things the table deliberately does not have:
--   * no payee list, no spend history and no agent address column. A serial is a capability — anyone
--     holding it can read the record — so the public path must not be able to return those fields even
--     if a future schema adds them. They stay inside `scope`/`envelope`, which the read adapter strips.
--   * no state change by rewriting `envelope`. Revocation is a second, signed statement stored beside
--     the immutable mandate (`revocation`, `revoked_at`) and a state update; the signed bytes are never
--     edited.
--
-- Write path is server-side: the writer and the public read use the service role, which bypasses RLS.
-- The policies below are for tenant-scoped sessions — they are the difference between a product and a
-- data incident, so they ship in this first migration rather than "later".
--
-- Apply through the repo's normal migration path, not by hand. This file contains no credentials.

create table if not exists public.mandates (
  -- The public identifier. The pass renders `vch-ABC`; the full form is `vch_` plus >=128 random bits.
  serial text primary key check (serial ~ '^vch[-_][A-Za-z0-9_-]+$'),
  -- Which tenant owns the record. Every RLS policy compares against this column.
  tenant_id text not null check (tenant_id <> ''),
  -- The package's three states. `expired` is materialised by the writer at insert; the endpoint still
  -- recomputes expiry from `expires_at` so a stale `active` row cannot pass.
  state text not null check (state in ('active', 'revoked', 'expired')),
  -- The signed scope, verbatim. Includes `allowed_payees` when the principal wrote one; the public
  -- adapter removes it before the endpoint sees the record.
  scope jsonb not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  -- Display label and the agent identity. Neither is returned by the public endpoint (see adapter).
  principal text not null check (principal <> ''),
  agent text not null check (agent <> ''),
  -- The signed envelope exactly as verified. This is the record; the columns above are derived.
  envelope jsonb not null,
  -- Set only by the revocation update. `envelope` is never touched by that path.
  revoked_at timestamptz,
  revocation jsonb,
  created_at timestamptz not null default now()
);

-- The tenant policies filter on this column; without an index every tenant read is a full scan.
create index if not exists mandates_tenant_id_idx on public.mandates (tenant_id);

alter table public.mandates enable row level security;

-- The tenant claim the policies read. PostgREST puts the verified JWT claims here per request. A
-- session without a claim gets NULL and matches no row; a malformed/empty setting also fails closed.
-- The public endpoint does not use these policies — it reads with the service role and returns a
-- project that omits agent, payees and revocation bytes.
comment on table public.mandates is
  'Signed mandates (#453), one row per serial. envelope is the verified object and the source of truth; tenant_id drives RLS; no payee/spend/agent columns on the public path.';

-- A tenant may read its own records. No policy grants anon or cross-tenant reads: there is no
-- `using (true)`, and an unauthenticated caller has no claim to match.
create policy mandates_tenant_select on public.mandates
  for select to authenticated
  using (
    tenant_id = nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id'
  );
comment on policy mandates_tenant_select on public.mandates is
  'Read a mandate only when the caller JWT tenant_id equals the row tenant_id. Protects the envelope and agent identity from cross-tenant reads.';

-- A tenant may insert only into itself. `with check` is what stops a session writing a row under
-- another tenant's id and then reading it back through the select policy.
create policy mandates_tenant_insert on public.mandates
  for insert to authenticated
  with check (
    tenant_id = nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id'
  );
comment on policy mandates_tenant_insert on public.mandates is
  'Insert only with the caller own tenant_id. Protects tenants from rows planted under their id.';

-- Revocation is an update of state/revoked_at/revocation on the same row. Both clauses are tenant
-- scoped, so a session can neither reach another tenant's row nor move its own row into another tenant.
create policy mandates_tenant_update on public.mandates
  for update to authenticated
  using (
    tenant_id = nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id'
  )
  with check (
    tenant_id = nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id'
  );
comment on policy mandates_tenant_update on public.mandates is
  'Update only the caller own tenant row, and not its tenant_id. Protects against revocation or state edits on another tenant record.';

-- No delete policy on purpose: deleting a row would erase the record a revoked QR still points at,
-- and a capability must remain answerable. Deletion is an operator decision outside the API surface.
