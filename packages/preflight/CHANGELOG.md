# Changelog

## @paystage/preflight 0.1.1 — 2026-11-02

- Refresh curated known-drainer hard-deny list (+7 Base/EVM addresses from 0xCERT, Matcha/SwapNet advisory, Chainabuse; citations in KNOWN_DRAINERS.md).

## @paystage/mcp 0.2.2 — 2026-11-02

- Depend on `@paystage/preflight@0.1.1` so `evaluate_mcp_payment` picks up the refreshed known-drainer list.

