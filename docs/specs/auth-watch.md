# PayStage Outstanding-Auth Watch (`@paystage/auth-watch`)

**Product:** Tool #2 in PayStage. MCP stdio server. **READ-ONLY.** No private keys. No signing. No cancel txs in v0.1.0 (flag only; cancel is a later tool or human step).

## Problem
Agent wallets accumulate ERC-20 `approve` allowances, Permit2 allowances, and EIP-3009-style USDC authorizations. Unlimited or stale approvals are a silent drain risk.

## Scope v0.1.0
Chains: Base mainnet `eip155:8453` and Base Sepolia `eip155:84532`.

1. **Input:** wallet address + policy path/object + optional token list (default: `policy.allowed_assets`) + optional known spender hints.
2. **Discover/list:**
   - ERC-20 allowances for each token×spender pair (spender list = `policy.allowed_pay_to` ∪ optional extra spenders ∪ Permit2).
   - Permit2 `AllowanceTransfer.allowance(owner, token, spender)` when Permit2 is relevant.
   - EIP-3009 USDC `authorizationState(authorizer, nonce)` for nonces supplied by the caller. Do **not** invent a full nonce scan; document that callers pass candidate nonces or an inclusive range small enough for `eth_call` budgets.
3. **Evaluate** each outstanding auth against policy overlays:
   - Optional policy fields (to be added as optional on `@paystage/policy`): `max_auth_validity_seconds`, `allowed_spenders` (address[]), `disallow_unlimited_approvals` (bool, default `true`).
   - Flags: `unlimited`, `unknown_spender`, `stale` (if timestamp/expiration known and older than `max_auth_validity_seconds`), `ok`.
4. **Verdicts** per item + summary: `ok` | `review` | `revoke_recommended` (map `unknown_payee` deny → harsher).
5. **MCP tools:**
   - `list_outstanding_auths` — returns structured JSON list.
   - `evaluate_outstanding_auths` — list + policy flags/summary.
6. **Env:** `PAYSTAGE_POLICY_PATH`, `PAYSTAGE_RPC_URL` (default public `https://mainnet.base.org` for 8453; Sepolia `https://sepolia.base.org`). Optional `ALCHEMY_API_KEY` or full URL via `PAYSTAGE_RPC_URL` only — never commit secrets.
7. **Constants:**
   - USDC Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - USDC Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
   - Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
8. **Out of scope v0.1:** broadcasting revoke/cancel, multi-chain beyond Base, indexer dependency, custody.
9. **Testing:** unit tests with mocked JSON-RPC; no live network required for CI.
10. **Package layout** mirrors `@paystage/preflight` (`src/cli.ts`, `server.ts`, `index.ts`, `types`, `rpc`, `scan`, `evaluate`; `tests/`; `package.json` publish-ready but **DO NOT publish**).
