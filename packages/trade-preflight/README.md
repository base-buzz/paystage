# @paystage/trade-preflight

Preflight checks for Hyperliquid HIP-3 (trade.xyz) trades. Given a `TradeProposal` and a `TradePolicy`, returns a decision of `allow`, `review`, or `do_not_trade` before an agent places an order.

## TradePolicy example

```json
{
  "version": 1,
  "dex": "xyz",
  "allowed_assets": ["BTC", "ETH"],
  "max_notional_usd": 5000,
  "max_leverage": 5,
  "allowed_sides": ["buy", "sell"],
  "allowed_order_types": ["limit"],
  "require_limit_px": true
}
```

## CLI

```bash
npx @paystage/trade-preflight evaluate --proposal proposal.json --policy policy.json
```

## MCP

The package exposes an MCP tool `evaluate_hip3_trade` (also re-exported by `@paystage/mcp`). Inputs: `proposal`, `policy`, optional `snapshot`. If `snapshot` is omitted, the server fetches meta and asset contexts from the Hyperliquid info API for the proposal's `dex` (default `xyz`).

## HIP-3 / trade.xyz

HIP-3 perp dexes (e.g. `dex: "xyz"`) are resolved via the Hyperliquid info API (`metaAndAssetCtxs`). See https://docs.trade.xyz for HIP-3 details.

## Status

Private `0.0.0` — not published to npm. Consumed locally via `file:` dependency from `@paystage/mcp`.
