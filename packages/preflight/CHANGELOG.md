# Changelog

## @paystage/preflight 0.2.3 — unreleased

- `evaluatePayment` accepts `{ paymentIdentifier }`. When the same identifier has already produced a `pay` verdict inside the window (ten minutes by default, overridable), the second verdict
  is `review` with a reason that says so: an agent that times out after `pay` and retries the same logical purchase no longer gets a second approval (#187, issue #228). In-memory and
  per process — see LIMITS.md 6b for the bounds.
- `@paystage/mcp`: `evaluate_mcp_payment` gains the optional `payment_identifier` argument.

## @paystage/preflight 0.2.2 — 2026-11-10

- `evaluatePayment` accepts `{ agentId }`. When a policy declares `agents`, the
  payment is judged against that agent's narrowed ceiling, and an unknown or missing
  agent id is `do_not_pay` rather than falling back to the global policy.
- README: supply-chain disclosure section.

## @paystage/preflight 0.2.1 — 2026-11-09

- Nothing functional; published to bring the package in line with the umbrella after
  the Trusted Publishing setup.

## @paystage/preflight 0.1.1 — 2026-11-02

- Refresh curated known-drainer hard-deny list (+7 Base/EVM addresses from 0xCERT, Matcha/SwapNet advisory, Chainabuse; citations in KNOWN_DRAINERS.md).
