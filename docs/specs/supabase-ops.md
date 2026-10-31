# PayStage Supabase Ops

No secrets are stored in this document.

## Project

- Dashboard: https://supabase.com/dashboard/project/dtfvyvhziduhkkazpblb
- Project ref: `dtfvyvhziduhkkazpblb`
- Plan: free
- Region: us-west-2
- Org: GMA

## Secret files (never commit)

Stored on the box under `/home/box/.secrets/`:

- `supabase-paystage.token` — personal access token (PAT)
- `paystage-supabase.env`
- `paystage-supabase-url.txt`
- `paystage-supabase-anon.key`
- `paystage-supabase-service-role.key`

## Applying migrations

Migrations live in `supabase/migrations/`. Apply them either:

- Via the Management API: `POST /v1/projects/{ref}/database/query` with the PAT, or
- Via the Supabase CLI.

## Key rotation

1. Dashboard → Project Settings → API.
2. Update the box secret files listed above.
3. Update Worker secrets:
   - `wrangler secret put SUPABASE_URL`
   - `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
   - on Workers `paystage-hosted` and `paystage-hosted-sepolia`.
4. For the console preview also set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Redeploy sepolia + preview (and the mainnet Worker if the change is secrets-only).

## Backups

Free tier has limited recovery. Recommend a weekly `pg_dump` or dashboard backup export.

## Free-tier pause risk

Inactive projects pause after ~7 days. If the project pauses, the public status page and dashboard break.

## Heartbeat

Until `@paystage/loadgen` ships, run a daily Cloudflare cron or GitHub Action that either:

- `SELECT`s from `issue_flags`, or
- inserts one `source=test` heartbeat event via the service role.

Document that loadgen mainnet traffic will also keep the project warm.

## RLS

- `events`: SELECT for `anon` / `authenticated`.
- `incidents`: SELECT where `public = true`.
- INSERT: service role only.

## Preview URL

https://paystage-console-preview.basebuzz69.workers.dev

This is not production (`paystage.xyz`).
