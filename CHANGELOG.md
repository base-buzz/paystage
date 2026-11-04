# Changelog

## 2026-11-05

- Released: `@paystage/policy` 0.2.0, `@paystage/preflight` 0.2.0, `@paystage/auth-watch` 0.2.0, `@paystage/velocity` 0.2.0, `@paystage/trade-preflight` 0.2.0, `@paystage/mcp` 0.3.0.
- Security: zod 3 -> ^4.6.7 in all packages, fixing GHSA-mrhx-c7xc-m3w5 (high; memory exhaustion validating oversized constrained collections). Minor bump because policy schemas are now zod 4.
- Supply chain: migrated from `@modelcontextprotocol/sdk` v1 to the official split v2 package `@modelcontextprotocol/server` ^2.4.0. `@paystage/mcp` install tree drops from ~100 packages to ~8 (no express, hono, cors, cross-spawn, jose, ajv, eventsource, etc.).
- MCP: same 5 tools, same names, same arguments; payment decisions verified identical vs 0.2.2. Advertised tool input schemas are now JSON Schema 2020-12; `evaluate_mcp_payment` marks `payment_required` as required (it always was).
- Packaging: source maps no longer shipped; internal `@paystage` deps pinned exact.
- Release: GitHub Actions release workflow now builds before typecheck (fixes the failed 2 Nov run), publishes all six packages in dependency order with npm provenance (Trusted Publishing to be enabled per package).
- New `SECURITY.md` with a "What this package accesses and why" section (policy file read, `PAYSTAGE_POLICY_PATH` / `PAYSTAGE_RPC_URL`, Base RPC + Hyperliquid info reads).
- Known-drainer list: +4 cited addresses (21 total) — three Step Drainer payout wallets (0xCERT-2026-0292) and the Mercado Bitcoin incident address also seen on Base (0xCERT-2026-0303/0308).
- Docs: README quick start notes the server waits silently for an agent app (Ctrl+C to exit) and how to try tools with the MCP Inspector; local-install config (community PRs #1-#3, thanks).
- Dev: vitest 2 -> 4 (clears dev-only tinypool/esbuild advisories); `npm audit` reports 0 vulnerabilities.

## 2026-11-02

- `@paystage/preflight@0.1.1` + `@paystage/mcp@0.2.2`: known-drainer list refresh (+7 cited Base/EVM addresses).

