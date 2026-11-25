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
wrangler secret put PAYSTAGE_PROVENANCE_KEY

# sepolia
wrangler secret put SUPABASE_URL --env sepolia
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env sepolia
wrangler secret put PAYSTAGE_PROVENANCE_KEY --env sepolia
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

## Caller provenance (#430)

`source` records what kind of caller it was, as labelled by the caller. It
cannot answer the question the 90-day test publishes: how many *non-own*
callers use the gate, and whether they come back.

Every event also carries `caller_provenance`, set **only** from a signed header:

```sh
x-paystage-provenance: own-ci | own-loadgen | own-probe
x-paystage-provenance-sig: <hex HMAC-SHA256 of the provenance value>
```

The signature is verified with Web Crypto against `PAYSTAGE_PROVENANCE_KEY`.
A missing key, missing header, missing/malformed signature, value outside the
allowlist, or a mismatch all resolve to `unknown`. The check never throws and
never logs the key or the signature. Nothing is inferred from an IP, user
agent or referrer.

`unknown` is **not** "external". It is the absence of a signed label, and it
is printed as its own bucket. An external caller who sends no header is
indistinguishable from one of ours that does not sign.

The weekly line is `node scripts/caller-provenance-report.mjs` from the repo
root; run it through `/work/ops/bin/with-secret supabase …` so it can read the
events table. If it cannot reach a live source it prints `unknown` and exits
non-zero rather than inventing a number.

## Schema / migrations

Telemetry tables live under `supabase/migrations/`. Apply migrations with the
Supabase CLI:

```sh
supabase db push
```

Tables:

- `events` — one row per payment-path request (`ts`, `source`, `tool`,
  `decision`, `reason_codes`, `network`, `latency_ms`, `amount_usdc`,
  `tx_hash`, `request_id`, `caller_provenance`, `error_class`).
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
