-- Evidence bundles (#308): the record of one decision, not just its verdict.
--
-- One row is one `runs/<id>` directory: the evaluator's ordered steps, the canonical
-- inputs and their hashes, the receipt when the deployment signed one, and a
-- human-readable summary. The four artefacts are stored as text, not parsed JSON, so a
-- reader serves the exact bytes that were written.
--
-- Read path is SERVER ONLY, like probe_runs: RLS is enabled with no policy on purpose.
-- The anon key must read zero rows. The service role reads through
-- apps/hosted/src/bundle-store.ts, and the public route `GET /runs/:id` exposes one row
-- by its content-addressed id. No listing endpoint exists, because a bundle contains a
-- caller's policy and payment terms.
--
-- Apply this migration through the repo's normal migration path; nothing here is
-- hand-applied, and no credentials live in this file.

create table if not exists public.evidence_bundles (
  -- SHA-256 over canonical JSON of the inputs, lowercase hex. The same decision always
  -- has the same id, which is what makes the record reproducible.
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  decision text not null check (decision in ('pay', 'review', 'do_not_pay')),
  -- events.jsonl: one canonical-JSON evaluator step per line, in execution order.
  events text not null,
  -- proof: canonical JSON of the inputs, their hashes, and the recorded verdict.
  proof text not null,
  -- receipt: canonical JSON when the host produced one; NULL is a fact, not a gap.
  receipt text,
  -- summary.md: generated from the same data as the other three.
  summary text not null
);

create index if not exists evidence_bundles_created_at_idx
  on public.evidence_bundles (created_at desc);

alter table public.evidence_bundles enable row level security;

comment on table public.evidence_bundles is
  'Per-decision evidence bundles (#308). Server-side only: RLS enabled, no anon policy.';
