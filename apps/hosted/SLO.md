# Service levels and failure behaviour

What this service promises, how it fails, and how a caller can tell whether it is
behaving. Every number here is measured, dated, and reproducible with
`node apps/hosted/scripts/latency.mjs`.

## Targets

| Property | Target | Status |
|---|---|---|
| Availability, `GET /health` | 99.9% monthly | not yet measured over a window |
| Availability, `POST /v1/evaluate_mcp_payment` | 99.9% monthly | not yet measured over a window |
| Server time, unpaid 402 — warm isolate | p50 ≤ 10 ms, p95 ≤ 50 ms | **met** — p50 0 ms / p95 0 ms (2026-11-09, n=20) |
| Server time, unpaid 402 — first request in a fresh isolate | p95 ≤ 400 ms | **~220-260 ms** (2026-11-09) |
| Server time, paid evaluation | p50 ≤ 150 ms, p95 ≤ 500 ms | **not measured** — needs a funded wallet |
| Time to first byte, external | p50 ≤ 150 ms from NZ | **met** — 18 ms wall (2026-11-09) |

Availability targets are stated to be measured, not claimed. Until a rolling window
exists, treat them as intent and use `/v1/public/status` for current incidents.

## How to measure it yourself

Every response carries `Server-Timing: app;dur=<ms>`. That is the service's own
view of the request; wall-clock includes network and is usually dominated by it.

```sh
node apps/hosted/scripts/latency.mjs --n 50
```

The script measures the two paths that need no payment. It deliberately does not
call a paid evaluation, and says so in its output: a fast 402 is not a fast
verdict, and conflating them would be the kind of number this project refuses to
publish.

## Failure semantics

**The default is fail-closed.** If the service cannot evaluate, it does not say
`pay`. A caller must treat any non-200 as "do not proceed".

| Condition | Response | What the caller should do |
|---|---|---|
| Malformed JSON | `400 invalid_json` | fix the request; do not pay |
| Missing `payment_required` | `400 missing_payment_required` | fix the request; do not pay |
| Policy fails schema validation | `400 evaluation_failed` + message | fix the policy; do not pay |
| No payment supplied | `402` + challenge | pay per the challenge, then retry |
| Facilitator unreachable | `502`-class from the x402 layer | retry with backoff, then fail closed |
| Unexpected error | `500` | retry with backoff, then fail closed |

### Retries

`POST /v1/evaluate_mcp_payment` is **read-only and idempotent** — it evaluates, it
does not settle. Safe to retry on 5xx and on transport errors, with exponential
backoff. The receipt differs between attempts only in `issued_at` and (when
signed) the signature, so a caller comparing receipts should compare the
`request_sha256` / `policy_sha256` / `verdict` fields, not the whole object.

Settlement is not idempotent at this layer; it belongs to the x402 flow.

### Timeouts

The Worker has no explicit request timeout; Cloudflare's edge limits apply.
Callers should set their own at **5 s** for an evaluation and treat expiry as
fail-closed. A 5 s wait is already well past the p95, so a timeout means something
is wrong, not slow.

## What this service does not do

- It does not hold keys, sign, or settle on the caller's behalf.
- It does not retry a paid call for you; that is the caller's policy.
- It does not guarantee the drainer list is complete — only that every entry is
  cited.

## Cold-start tax (be precise about this)

The numbers above are **warm-isolate** numbers. A fresh isolate pays the
facilitator's `getSupported()` discovery once, measured at **~220-260 ms**. Six
rapid requests after a quiet period returned `app;dur=0.0`; requests after ~10
minutes idle returned `app;dur=224-257`.

So the honest statement is: *warm requests are effectively free; the first request
in a new isolate costs a quarter of a second.* Under sustained traffic that
amortises to nothing. Under bursty, low-volume traffic — which is what this service
sees today — most calls may pay it.

Mitigations considered and not taken yet: a keep-warm cron (fights the platform,
extra invocations), pre-seeding supported kinds instead of discovering them (needs
a static config path in the x402 server), or accepting it and setting expectations.
Currently accepting it and setting expectations.

## Known cost of trust

`getSupported()` discovery against the CDP facilitator used to run on every
request: ~220 ms of server time per call, measured 2026-11-09. Fixed by building
the app once per isolate (`af3eb0f` → `f1a2c3`-era change, see CHANGELOG).
Unpaid 402 went from 265 ms to 18 ms wall. Recorded here because it is the kind of
regression that a p95 target would otherwise hide behind a green dashboard.
