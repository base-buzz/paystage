# @paystage/trade-preflight

MCP tool: evaluate HIP-3 / trade.xyz orders against a local `TradePolicy` before trading.

> Not financial advice. This is a local policy gate only — it does not place orders, route
> orders, or recommend trades. It evaluates a proposed order against rules you define and
> returns a decision.

Published on npm as **`@paystage/trade-preflight@0.1.2`**.

## What it does

Given a proposed HIP-3 / trade.xyz order and a local policy file, the server returns one of:

- `allow` — the order satisfies every rule in the policy
- `review` — the order needs a human or higher-level check before proceeding
- `do_not_trade` — the order violates a hard rule in the policy

The decision is deterministic and local. No network calls are required to evaluate a policy;
the tool is a gate you put in front of your own order flow.

## Install

Run directly with `npx`:

```sh
npx -y @paystage/trade-preflight
```

Or install it:

```sh
npm install @paystage/trade-preflight
```

The package exposes a `stdio` MCP server (bin: `paystage-trade-preflight`).

## MCP configuration

```json
{
  "mcpServers": {
    "paystage-trade-preflight": {
      "command": "npx",
      "args": ["-y", "@paystage/trade-preflight"]
    }
  }
}
```

No environment variables are required. The policy is passed as a tool argument.

## Tool

### `evaluate_hip3_trade`

Evaluates a proposed HIP-3 / trade.xyz order against a local `TradePolicy`.

Inputs (shape):

- `order` — the proposed order (market, side, size, price/limit, etc.)
- `policy` — the local `TradePolicy` object (or a path to it, depending on your setup)

Output:

- `decision` — `allow` | `review` | `do_not_trade`
- `reasons` — list of rule results explaining the decision

Example policy shape:

```json
{
  "version": 1,
  "max_notional": { "value": "100.00", "asset": "USDC", "decimals": 6 },
  "allowed_markets": ["BTC-USD", "ETH-USD"],
  "allowed_sides": ["buy", "sell"],
  "max_leverage": 1,
  "unknown_market": "review"
}
```

## Decisions

| Decision | Meaning |
| --- | --- |
| `allow` | Order satisfies all policy rules. |
| `review` | Order needs a human or higher-level check. |
| `do_not_trade` | Order violates a hard policy rule. |

## Links

- Website: [paystage.xyz](https://paystage.xyz)
- HIP-3 context: [docs.trade.xyz](https://docs.trade.xyz)
- Source: [github.com/base-buzz/paystage](https://github.com/base-buzz/paystage) (`packages/trade-preflight`)

## License

MIT
