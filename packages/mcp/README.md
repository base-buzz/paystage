# @paystage/mcp

PayStage umbrella MCP server: x402 payment preflight, outstanding-auth watch, and HIP-3 trade preflight.

In addition to the payment and auth tools, this server exposes `evaluate_hip3_trade`, which evaluates a Hyperliquid HIP-3 (trade.xyz) order against a `TradePolicy` and returns `allow | review | do_not_trade`. It is backed by `@paystage/trade-preflight`, which is currently wired as a local `file:` dependency and is not yet published to npm.
