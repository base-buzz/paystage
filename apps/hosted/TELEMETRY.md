# PayStage Telemetry

PayStage records lightweight telemetry for every payment-path request so the
console can show volume, latency, and issues. Telemetry is **fire-and-forget**:
the payment path never fails because of a telemetry write.

## Secrets

Set these as Worker secrets — never commit them to the repo.

```sh
# mainnet
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# sepolia
wrangler secret put SUPABASE_URL --env sepolia
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env sepolia
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not expose it to the browser or
to any client bundle.

## Source header

Every request may include:

```
x-paystage-source: real | synthetic | test
```

- `real` — genuine end-user traffic (default when the header is absent).
- `synthetic` — internal probes / uptime checks.
- `test` — CI and integration tests.

The header is normalized to `real` if missing or unrecognized. The console
aggregates `real` and `synthetic` separately and excludes `test` from volume
charts.

## Schema / migrations

Telemetry tables live under `supabase/migrations/`. Apply migrations with the
Supabase CLI:

```sh
supabase db push
```

Tables:

- `events` — one row per payment-path request (`ts`, `source`, `tool`,
  `decision`, `reason_codes`, `network`, `latency_ms`, `amount_usdc`,
  `tx_hash`, `request_id`, `error_class`).
- `incidents` — operator-authored incidents (`opened_at`, `closed_at`,
  `severity`, `title`, `summary`, `status`, `public`).

## Public status endpoint

`GET /v1/public/status` is unpaid and unauthenticated. It returns a small JSON
summary (flags, uptime, incident count) used as a fallback when the console has
no Supabase credentials configured.

## Guarantees

- Writes are fire-and-forget; failures are logged and swallowed.
- The payment path never blocks on telemetry.
- Secrets are only read server-side via `wrangler secret`.
- Never commit `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` to git.
