# Security Policy

PayStage is a read-only "seatbelt" that sits outside an AI agent's wallet. It evaluates x402 payment requests, outstanding token approvals, HIP-3 trade orders and payment velocity against a local policy **before** the agent pays. It never holds keys, never signs, and never sends transactions.

## Reporting a vulnerability

Please report security issues privately:

- **Preferred:** open a GitHub security advisory at https://github.com/base-buzz/paystage/security/advisories/new
- **Non-sensitive bypasses:** a regular issue is fine if the report does not expose an exploitable path.

A **preflight bypass counts as a security bug**: if an unsafe payment is evaluated and still returns `pay`, treat it as a vulnerability and report it privately. Please include the policy, the request, and the expected vs. actual decision.

## Supported versions

Security fixes are issued for the **latest minor** of each `@paystage/*` package. Older minors are not supported; upgrade to the latest release before reporting.

## What this package accesses and why

| Access | Where | Why | How to restrict |
| --- | --- | --- | --- |
| Filesystem read | `@paystage/policy` `loadPolicy()` reads the policy JSON at the tool's `policy_path` argument, else env `PAYSTAGE_POLICY_PATH`, else `./policy.json` (used by `preflight` and `mcp`). `@paystage/velocity` reads `policy_path` if given. | Load the local policy that decisions are evaluated against. | Point `policy_path`/`PAYSTAGE_POLICY_PATH` at a single known file and run the server with read access to only that path. Nothing is written to disk. |
| Environment variables (packages) | `PAYSTAGE_POLICY_PATH` (policy file location), `PAYSTAGE_RPC_URL` (override RPC for `auth-watch`). | Locate the policy and optionally pin the RPC endpoint. | The packages read only these two. |
| Environment variables (hosted worker) | `PAYSTAGE_PAYTO`, `PAYSTAGE_PRICE`, `PAYSTAGE_NETWORK`, `PAYSTAGE_SERVICE_VERSION`, `FREE_TIER_ENABLED`, `FREE_TIER_DAILY_LIMIT`, `PAID_QUOTA_ENABLED`, `PAID_QUOTA_DAILY_LIMIT`, `FACILITATOR_URL`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RECEIPT_SIGNING_KEY_PKCS8`, `RECEIPT_SIGNING_KEY_ID`, `RECEIPT_SIGNING_KEYS_RETIRED`, `FAUCET_SEPOLIA_KEY`, `SEPOLIA_RPC_URL`, `PAYSTAGE_SERVICE_VERSION`. | Pricing, payee, quotas, settlement, telemetry, receipt signing, and the testnet faucet. | All are Worker secrets or vars set by CI; none is read from a caller's request. |
| Environment variables (console) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_BASE_RPC`, `NEXT_PUBLIC_STATUS_URL`, `SIWE_SESSION_SECRET`, `PAYSTAGE_API_URL`, `PAYSTAGE_E2E_KEY_FILE`, `PAYSTAGE_BUILD_SHA`, `PAYSTAGE_BUILD_AT`, `GITHUB_SHA`. | Public config for the site and the wallet session cookie. | The `NEXT_PUBLIC_*` names are public by definition; `SIWE_SESSION_SECRET` is the only secret, and it signs a session cookie rather than storing one. The three build variables are not secret either: `/api/build` publishes the commit that built the deployment, so a green deploy of the wrong commit is visible instead of invisible. |
| Environment variables (tooling) | `SLO_TARGET`, `SLO_PROBE_INTERVAL_MINUTES`, `UPTIME_HISTORY`, `CANARY_LOG`, plus the loadgen and scan scripts' own `LOADGEN_ENABLED`, `LOADGEN_KEY_1`, `LOADGEN_KEY_2`, `LOADGEN_KEY_3`, `LOADGEN_KILL`, `LOADGEN_PAY`, `LOADGEN_START_DATE`, `LOADGEN_STATE`, `SCAN_LIMIT`, `NPM_REGISTRY`, `API_BASE`, `BASE_URL`, `PAYSTAGE_REPO`, `PAYSTAGE_LANDER`, `PAYSTAGE_DISTRIBUTION`, `PAYSTAGE_API`, `PAYSTAGE_API_SEPOLIA`, `PAYSTAGE_SITE`, `PAYSTAGE_PAY_TO`, `PAYSTAGE_E2E_BASE_URL`, `PAYSTAGE_CONFORMANCE_TIMEOUT_MS`, `ALCHEMY_KEY`, `ALCHEMY_API_KEY`, `ALCHEMY_BASE_URL`, `BASE_RPC_URL`, `CF_PAGES`, `CF_WORKER`, `CLOUDFLARE_ENV`. | Operator scripts only; they never run in the hosted path. | Nothing here is required for a caller, and no script runs during a request. |

`scripts/check-env-vars.mjs` compares this table against the code in both directions and fails CI on either asymmetry, so "only these two" cannot stay confidently wrong.
| Network | Four calls exist, all from the packages, none from `preflight`, `policy` or `velocity`. (1) `@paystage/auth-watch` makes JSON-RPC `eth_call` requests (allowance/nonce reads) to `PAYSTAGE_RPC_URL`, the defaults `https://mainnet.base.org` / `https://sepolia.base.org`, or an `rpc_url` argument. (2) `@paystage/trade-preflight` and the `evaluate_hip3_trade` tool POST a read-only `metaAndAssetCtxs` query to `https://api.hyperliquid.xyz/info` only when no snapshot is passed. (3) `request_testnet_funds` POSTs the address to `https://sepolia.api.paystage.xyz/faucet` with an `x-paystage-client` header naming the package version — a user-initiated request to our own service, and the only outbound request that carries anything about the caller's build. (4) `verify_receipt` fetches the receipt public key from `https://api.paystage.xyz/v1/public/receipt-key.json` unless the caller supplies `key_url`. Separately, `@paystage/x402-guard` wraps a caller's `fetch`: it calls whatever URL that caller was already calling. | Read on-chain approval/nonce state, market context, testnet funds, and the receipt key. | Set `PAYSTAGE_RPC_URL` to your own node; pass a snapshot to avoid the Hyperliquid call; pass `key_url` to pin a key; do not call the faucet tool. |
| Telemetry | **None by default.** No analytics endpoint, no beacon, no identifier in a request the caller did not make. Two qualifications, both caller-controlled: (1) the faucet tool's `x-paystage-client` header carries the package version and nothing else — no IP is read, no user id exists, and it attributes faucet load to a build (issue #52); (2) `@paystage/x402-guard` accepts an **optional `telemetryUrl`** and, only if you set it, POSTs each verdict there with an `x-paystage-source` label defaulting to `test`. With no `telemetryUrl`, nothing leaves the process. | Load attribution for a shared faucet, and an opt-in collector for users who want their own verdict log. | Do not call `request_testnet_funds`; do not set `telemetryUrl`. |
| stdio | The MCP servers talk JSON-RPC over stdin/stdout to the agent app that launched them. | Standard MCP transport. | No HTTP server and no listening port; scope the process to the launching agent. |

PayStage has **no shell/child processes, no `eval`, no telemetry, and no private keys**.

## Supply chain

- Runtime dependencies are only **`zod` (^4.6.7)** and the official **`@modelcontextprotocol/server` v2 SDK** (which depends only on `@modelcontextprotocol/core` and `zod`), plus other `@paystage/*` packages pinned to exact versions.
- As of `mcp` 0.3.0 we moved off `@modelcontextprotocol/sdk` v1, which pulled in ~90 transitive packages (express, hono, cors, cross-spawn, ajv, jose, eventsource, ...) that a stdio-only server never used. This removed the dependency behind Socket's shell-access, unmaintained-package and most network/env alerts.
- Upgraded `zod` 3 -> 4.6.7 to fix **GHSA-mrhx-c7xc-m3w5** (high, memory exhaustion validating oversized collections).
- Published tarballs contain only `dist/*.js`, `*.d.ts`, `README` and `server.json` — no source maps, tests or sources.
- Releases are built in GitHub Actions (`.github/workflows/release.yml`) and published with npm provenance via Trusted Publishing once enabled per package. Verify with `npm audit signatures`.
- Remaining Socket alerts on the bundled MCP SDK (e.g. dynamic code generation used by its JSON-schema validator, URL strings in protocol code) are expected and come from the official SDK.
