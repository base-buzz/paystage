# @paystage/mcp

PayStage umbrella MCP server: payment preflight, auth watch, HIP-3 trade preflight, and velocity checks.

> Not financial advice. The trade preflight tool is a local policy gate only — it does not
> place orders or recommend trades.

Published on npm as **`@paystage/mcp@0.3.0`**.

## Install

```sh
npx -y @paystage/mcp
```

The server waits silently for an agent app to connect. That's normal; press Ctrl+C to exit. To try the tools without an app, run `npx @modelcontextprotocol/inspector npx -y @paystage/mcp`.

Or:

```sh
npm install @paystage/mcp
```

The package exposes a `stdio` MCP server (bin: `paystage-mcp`).

## MCP configuration

```json
{
  "mcpServers": {
    "paystage": {
      "command": "npx",
      "args": ["-y", "@paystage/mcp"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "./policy.json"
      }
    }
  }
}
```

Environment variables (all optional):

- `PAYSTAGE_POLICY_PATH` — path to `policy.json` spending rules
- `PAYSTAGE_RPC_URL` — Base RPC URL override

## Tools

### `evaluate_mcp_payment` — Available now

Evaluates a proposed x402 payment against a local policy file and returns a verdict before
the agent signs anything.

### `list_outstanding_auths` — Available now

Lists outstanding ERC-20, Permit2, and EIP-3009 authorizations.

### `evaluate_outstanding_auths` — Available now

Flags outstanding authorizations that need attention (e.g. authorized but never settled).

### `evaluate_hip3_trade` — Available now

Evaluates a proposed HIP-3 / trade.xyz order against a local `TradePolicy` and returns a
decision: `allow` | `review` | `do_not_trade`.

Backed by [`@paystage/trade-preflight`](https://www.npmjs.com/package/@paystage/trade-preflight)
(`0.2.0`), which is also published on npm and can be run standalone:

```sh
npx -y @paystage/trade-preflight
```

The policy is passed as a tool argument; no extra environment variables are required for
this tool.

## Packages

| Package | Version | Purpose |
| --- | --- | --- |
| `@paystage/mcp` | 0.3.0 | Umbrella server (5 tools) |
| `@paystage/preflight` | 0.2.0 | x402 payment preflight |
| `@paystage/auth-watch` | 0.2.0 | Outstanding-auth tools |
| `@paystage/trade-preflight` | 0.2.0 | HIP-3 / trade.xyz trade preflight |
| `@paystage/velocity` | 0.2.0 | Rate / spend-pattern checks |
| `@paystage/policy` | 0.2.0 | Shared policy schema + loader |

## Supply chain and access

This is the umbrella, so its install tree is wider than any single tool and Socket
flags it accordingly. What it actually contains:

| Flag | Where it comes from |
| --- | --- |
| Network access, URL strings | `@paystage/auth-watch` (Base RPC reads) and `@paystage/trade-preflight` (one Hyperliquid info query). |
| Filesystem access | `@paystage/policy` reading your policy file. |
| Environment variable access | `PAYSTAGE_POLICY_PATH`, `PAYSTAGE_RPC_URL`. |
| "AI-detected code anomaly" | The official `@modelcontextprotocol/server` SDK's bundled JSON-schema validator, not PayStage code. |

The umbrella itself is ~16 KB with no network, no filesystem and no `eval` — the
capability lives in the dependencies, because that is what the tools are for.

Install a narrower surface if you only need part of it: `@paystage/preflight` and
`@paystage/policy` make no network calls at all.

Full table: [SECURITY.md](../../SECURITY.md).

## Links

- Website: [paystage.xyz](https://paystage.xyz)
- HIP-3 context: [docs.trade.xyz](https://docs.trade.xyz)
- Source: [github.com/base-buzz/paystage](https://github.com/base-buzz/paystage)

## License

MIT
