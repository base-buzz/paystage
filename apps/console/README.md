# @paystage/console

Operational dashboard for PayStage. Next.js 15 App Router, Tailwind v4,
Recharts. Server components fetch Supabase REST + public status.

## Layout

- Public status strip (top)
- Headline metrics: real calls (24h), issues open, uptime
- Issue flags
- Volume chart (real vs synthetic)
- Event feed (source-badged)
- Incidents

Synthetic and test traffic are always badged and never counted in the
headline "Real calls" metric.

## Environment

Create `apps/console/.env.local` (never commit):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-key>
# optional, for select-only access if you don't want the service role:
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
# optional override for public status flags:
NEXT_PUBLIC_STATUS_URL=https://sepolia.api.paystage.xyz/v1/public/status
```

If Supabase env is missing, the dashboard still renders with a
"Telemetry not configured" banner and empty states. Public status flags
are still fetched from `NEXT_PUBLIC_STATUS_URL`.

## Expected tables

- `telemetry_events(id, created_at, source, kind, status, latency_ms, route, message)`
  - `source` ∈ `real | synthetic | test`
- `incidents(id, created_at, title, severity, status, summary)`

## Dev

```
npm install
npm run dev
```

## Build

```
npm run build
npm run start
```

## Cloudflare preview (never production)

Preview project name: `paystage-console-preview` (see `wrangler.toml`).
`workers_dev = true`. Do **not** point this at `paystage.xyz`.

```
npm run preview:cf
```

This runs `opennextjs-cloudflare build` then `preview`. Deploy to the
preview worker only:

```
npx opennextjs-cloudflare build
npx wrangler deploy
```

Set the same env vars as Worker secrets/vars in the preview project.
Never commit secrets.

## API

`GET /api/metrics` returns the aggregated `MetricsSummary` JSON
(`Cache-Control: no-store`).
