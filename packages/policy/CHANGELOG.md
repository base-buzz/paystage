# Changelog

## 0.2.1 — 2026-11-10

- **Per-agent budgets.** `policy.agents` is a narrowing overlay: `max_amount`,
  `daily_cap`, `allowed_pay_to`, `allowed_assets`, `allowed_networks`,
  `unknown_payee`, `require_human_above`, `velocity`.
- `resolveAgentPolicy(policy, agentId)` resolves an agent or explains why it cannot be
  resolved. Overrides that widen (raise a ceiling, add a payee, loosen `deny` to
  `review`) are rejected; a missing or unknown agent is a denial, never a fallback to
  the global policy.
