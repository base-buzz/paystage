# Changelog

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
