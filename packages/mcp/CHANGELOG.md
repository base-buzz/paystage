# Changelog

## @paystage/mcp 0.8.16 — 2026-11-20

- `evaluate_mcp_payment` accepts an optional `payment_identifier`, and the paid endpoint now advertises the x402 `payment-identifier` extension. A repeat `pay` for the same id inside ten minutes
  is `review` rather than a second approval — the dedup logic shipped in `@paystage/preflight` on 2026-11-19 had no way to reach a caller that was never told it existed.
- No behaviour change when no identifier is supplied: the stateless contract is still the default.

## 0.3.2 — 2026-11-10

- **New: `paystage-verify`** — second bin. Checks a receipt against the published
  signing key (ECDSA-P256), with the challenge/decode handled correctly for Node
  (`dsaEncoding: ieee-p1363`). Exit codes separate invalid (1), unsigned (2) and
  unverifiable (3); collapsing them would overstate what a check proves.
- Bump `@paystage/preflight` to 0.2.2 and `@paystage/policy` to 0.2.1, so
  `evaluate_mcp_payment` accepts `agent_id` and honours per-agent budgets.
- README: supply-chain disclosure section, and how to verify a receipt.

## 0.2.2 — 2026-11-02

- Bump `@paystage/preflight` to 0.1.1 (known-drainer list refresh).
