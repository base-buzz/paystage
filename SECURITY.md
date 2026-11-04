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
| Environment variables | `PAYSTAGE_POLICY_PATH` (policy file location), `PAYSTAGE_RPC_URL` (override RPC for `auth-watch`). | Locate the policy and optionally pin the RPC endpoint. | Set only these two; no other env vars are read by PayStage code. |
| Network | `@paystage/auth-watch` makes JSON-RPC `eth_call` requests (allowance/nonce reads) to `PAYSTAGE_RPC_URL`, the public defaults `https://mainnet.base.org` (Base) / `https://sepolia.base.org` (Base Sepolia), or an `rpc_url` tool argument. `@paystage/trade-preflight` (and the `evaluate_hip3_trade` tool in `@paystage/mcp`) POSTs a read-only `metaAndAssetCtxs` query to `https://api.hyperliquid.xyz/info` only when the caller does not pass a snapshot. | Read on-chain approval/nonce state and market context. | Set `PAYSTAGE_RPC_URL` to your own node; pass a snapshot to avoid the Hyperliquid call. `preflight`, `policy` and `velocity` make no network calls. |
| stdio | The MCP servers talk JSON-RPC over stdin/stdout to the agent app that launched them. | Standard MCP transport. | No HTTP server and no listening port; scope the process to the launching agent. |

PayStage has **no shell/child processes, no `eval`, no telemetry, and no private keys**.

## Supply chain

- Runtime dependencies are only **`zod` (^4.6.7)** and the official **`@modelcontextprotocol/server` v2 SDK** (which depends only on `@modelcontextprotocol/core` and `zod`), plus other `@paystage/*` packages pinned to exact versions.
- As of `mcp` 0.3.0 we moved off `@modelcontextprotocol/sdk` v1, which pulled in ~90 transitive packages (express, hono, cors, cross-spawn, ajv, jose, eventsource, ...) that a stdio-only server never used. This removed the dependency behind Socket's shell-access, unmaintained-package and most network/env alerts.
- Upgraded `zod` 3 -> 4.6.7 to fix **GHSA-mrhx-c7xc-m3w5** (high, memory exhaustion validating oversized collections).
- Published tarballs contain only `dist/*.js`, `*.d.ts`, `README` and `server.json` — no source maps, tests or sources.
- Releases are built in GitHub Actions (`.github/workflows/release.yml`) and published with npm provenance via Trusted Publishing once enabled per package. Verify with `npm audit signatures`.
- Remaining Socket alerts on the bundled MCP SDK (e.g. dynamic code generation used by its JSON-schema validator, URL strings in protocol code) are expected and come from the official SDK.
