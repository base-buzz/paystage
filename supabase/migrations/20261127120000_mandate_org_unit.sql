-- Org units on a mandate (#471): the allocation label a roll-up sums over.
--
-- The column is deliberately an allocation label, not an authority: it is NOT signed and NOT part of
-- the envelope. A tenant's issuer chooses where a mandate sits in its own tree, exactly as it chooses
-- `tenant_id`; the signed bytes are unchanged. Moving a mandate between units would be an issuer
-- decision, not a second signature — but this migration only adds the column, not a move endpoint.
--
-- ## The path convention
--
-- A unit is a slash-separated path, lowercase, one path segment per level:
--
--     paystage/engineering/platform
--
-- * the **first segment is the tenant_id** (`paystage` above). A mandate may not be allocated outside
--   its own tenant, so a roll-up query is always scoped to one tenant and cannot read another's tree.
-- * each segment is 1-63 characters of `[a-z0-9-]`, must start and end with `[a-z0-9]`, and may not be
--   empty. No leading slash, no trailing slash, no `.`/`..`, no spaces, no uppercase. Maximum 8
--   segments / 200 characters.
-- * `NULL` means "no tree": a single-person install has no divisions to place a mandate in. A NULL row
--   is the tenant root for roll-up purposes (`paystage`), which is why the default is NULL.
-- * prefix matching is on whole segments only: `paystage/eng` is a prefix of `paystage/eng/platform`
--   and **not** of `paystage/engineering`. The roll-up implements this as an exact match plus a
--   `${unit}/` prefix, never a raw string prefix.
--
-- The mint (`POST /v1/mandate`) validates the same shape and the tenant-prefix rule before inserting;
-- this constraint is the database's half of that promise, so a row written by any other path cannot
-- contain a path the roll-up would misread.
--
-- Apply through the repo's normal migration path, not by hand. This file contains no credentials and
-- has not been applied to production by the author of #471.

alter table public.mandates
  add column if not exists org_unit text default null;

comment on column public.mandates.org_unit is
  'Allocation path (#471), e.g. paystage/engineering/platform. First segment is tenant_id; NULL = tenant root (no tree). Not signed and not part of envelope; validated on the mint path. Prefix matching is whole-segment only (eng does not match engineering).';

-- Prefix lookups are on whole segments: `paystage/eng` is a prefix of `paystage/eng/platform` and
-- **not** of `paystage/engineering`. The endpoint implements that as an exact match plus a `unit/`
-- prefix; this index is the tenant + org_unit shape that query needs when it is pushed into SQL, and
-- it still keeps a tenant's rows clustered while the endpoint filters in code at today's size.
create index if not exists mandates_tenant_unit_idx
  on public.mandates (tenant_id, org_unit text_pattern_ops);

-- Same shape as `ORG_UNIT_RE` in apps/hosted/src/org-unit.ts. Kept in SQL too so a row inserted outside
-- the API cannot carry a path the endpoint would silently exclude.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mandates_org_unit_path'
  ) then
    alter table public.mandates
      add constraint mandates_org_unit_path check (
        org_unit is null
        or (
          length(org_unit) <= 200
          and org_unit ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,7}$'
        )
      );
  end if;
end $$;

-- No policy change: the existing tenant select/insert/update policies already cover a new column on
-- the same row. A roll-up is a read with the service role inside the endpoint; this migration does not
-- open a cross-tenant read path.
