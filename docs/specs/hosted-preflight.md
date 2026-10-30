# Hosted pay-per-call preflight (apps/hosted)

## Product

- Cloudflare Worker behind `paystage.xyz` (or a subdomain like `api.paystage.xyz` later).
- Exposes PayStage tools as paid HTTP endpoints (and optionally streamable-HTTP remote MCP later).
- Client pays per call via x402 (USDC) before the tool runs.
- Service only **receives** payments. No private keys on the box or in the repo. Settlement via public facilitator.

## Stack (verified 2026)

- Hono on Cloudflare Workers
- `@x402/hono` + `@x402/evm` + `@x402/core` (v2.x) — `paymentMiddleware` + `x402ResourceServer` + `ExactEvmScheme` + `HTTPFacilitatorClient`
- Facilitator testnet: `https://x402.org/facilitator` (Base Sepolia, no API key)
- Network: `eip155:84532` (Base Sepolia) for v0; mainnet later
- `payTo`: env/binding `PAYSTAGE_PAYTO` (0x address). **NEVER invent a real wallet.** Tests use `0x00000000000000000000000000000000000000AA` or similar clearly fake.
- Price: configurable via `PAYSTAGE_PRICE`, default `$0.002` per protected call (~$0.001–0.005 range)

## Endpoints (v0)

- `GET /health` — free
- `POST /v1/evaluate_mcp_payment` — x402 protected; body = `{ payment_required, policy? }`; uses `@paystage/preflight` `evaluatePayment`
- `POST /v1/evaluate_outstanding_auths` — x402 protected; body matches auth-watch; read-only
- Optional later: remote MCP streamable HTTP (out of scope for first commit if heavy)

## Tests (vitest + miniflare or `app.request`)

1. Unpaid POST → 402 with PaymentRequired-shaped body/headers
2. Request with invalid/missing payment proof → reject (not 200)
3. Mock facilitator verify+settle success path → 200 + tool JSON

Do **not** require a real private key. Mock the facilitator HTTP client in unit tests.

## Out of scope v0

Mainnet, production deploy, CDP API keys, streaming MCP, custody.

## Dave must provide later

- Base receiving wallet (`PAYSTAGE_PAYTO`)
- Cloudflare account / `wrangler login` or API token for deploy

## Pricing

Proposed default: `$0.002` USDC per call on Sepolia for testing; production price TBD.

---

No personal names. No secrets. No trading advice.
