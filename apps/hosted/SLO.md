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
| Payment layer exceeded 5 s | `503 upstream_timeout` + `retry_after_seconds` | retry with backoff; do not pay |
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


## Known issue — facilitator discovery gates the challenge (2026-11-09)

The x402 middleware performs facilitator `getSupported()` discovery on a cold
isolate, and the 402 challenge path depends on it. When the facilitator rate-limits
that discovery, the retry-with-backoff can block a request for tens of seconds.

Mitigated, not fixed:

- The payment path now races a **5 s guard** and returns `503 upstream_timeout`
  with `retry_after_seconds`. A hang becomes a retryable error, which is what
  fail-closed is supposed to look like.
- Measured consequence: a burst of unpaid requests can now return **503 instead of
  402** while discovery is backing off. That is worse than a challenge and better
  than a hang. It is visible to any caller and to the conformance kit.

**Fixed 2026-11-09** by caching the discovery answer in the Workers Cache API
(10-minute TTL, per colo, no binding). Verified after deploy: first request 279 ms
(cold, populates the cache), then 12 ms, then 0 ms; a 10-request burst returned
ten 402s and no 503s. Cache failures fall through to the real facilitator.

Ruled out: setting `syncFacilitatorOnStart: false` to skip eager discovery — tried
2026-11-09, it breaks 4 of 40 tests because the challenge and verification paths
need the supported-kinds map.

Not yet tried, in rough order of preference: cache the discovery result in KV so a
cold isolate reads instead of asking; pin the facilitator's supported kinds at
deploy time; or move discovery off the request path entirely with a scheduled
refresh.

## Scalability — measured, not asserted

Measured 2026-11-11 against production, on the unpaid challenge path (the one an agent
hits first and a griefer would flood). Reproduce with `node scripts/load-test.mjs`.

| Load | Outcome | round-trip p50 | p95 | **worker time p95** |
|---|---|---|---|---|
| 300 calls, 20 concurrent | 300× `402` | 18 ms | 247 ms | 0 ms |
| 200 calls, 25 concurrent | 200× `402` | 21 ms | 239 ms | 0 ms |
| 100 calls, 100 concurrent | 100× `402` | 409 ms | 2,504 ms | **0 ms** |

The `server-timing: app;dur` header separates the two halves of a request, and the
separation matters: **the Worker spends zero milliseconds on a challenge.** Everything
in the round-trip column is connection setup and edge queueing, which is what happens
when one host opens a hundred fresh TLS connections at once. It is not the API being
slow, and the load script now prints both columns so the two cannot be conflated.

### Correction to an earlier reading

An earlier version of this section blamed high full-concurrency latency on cold-start
facilitator discovery. That was partly wrong: discovery *was* on the cold path and did
cost seconds per fresh isolate, but the numbers were measured before the fix and
attributed by inference rather than by the `server-timing` header. Once discovery was
removed from the request path the Worker time went to zero, and what remains is
connection setup. Measuring the right thing changed the conclusion.

### Three honest observations

**There is no application-level rate limit.** Nothing in the Worker counts requests.
Stateless design and the edge absorb volume; a determined caller is not slowed by us.
Publishing a limit we do not enforce would be worse than publishing none.

**Bursting costs connections, not compute.** 100 simultaneous requests from one host
push p95 to ~2.5 s while the Worker stays at 0 ms. An agent making sequential calls sees
the p50 column.

**A 503 means "retry", not "down".** The guard returns `503 upstream_timeout` with
`retry_after_seconds: 5` and an `x-paystage-debug` header naming the cause.

### What this means for a buyer

An agent paying per call should budget for a p99 near 400 ms and treat 503 as
retryable. If you need a hard per-caller limit, do it on your side or ask for a dedicated
deployment — we do not enforce one today, and publishing a limit we do not enforce would
be worse than publishing none.
