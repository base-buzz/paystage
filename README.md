# PayStage

Safety tools for AI agent payments (x402 + MCP).

PayStage sits in front of an agent's wallet and answers one question before money moves: should this payment happen? Tools return `pay`, `review`, or `do_not_pay`.

## Quick start

```bash
# Option 1: run instantly
npx -y @paystage/mcp

# Option 2: install locally, then use the package bin
npm install @paystage/mcp
npx paystage-mcp
```
It waits silently for an agent app to connect. That's normal, press Ctrl+C to exit. To try the tools without an app, run `npx @modelcontextprotocol/inspector npx -y @paystage/mcp`.

`@paystage/mcp` **0.2.2** is the umbrella MCP server (**5 tools**, including `evaluate_hip3_trade` and `evaluate_velocity`). It exposes the PayStage tools over stdio and reads a local policy file.

## Listed on

- [mcp.so](https://mcp.so/server/paystage)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=xyz.paystage)
- [npm](https://www.npmjs.com/package/@paystage/mcp)
- [GitHub](https://github.com/base-buzz/paystage)

## Configure

The same MCP config works for Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`).

### Using npx

```json
{
  "mcpServers": {
    "paystage": {
      "command": "npx",
      "args": ["-y", "@paystage/mcp"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json",
        "PAYSTAGE_RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

### Using a local npm install

```json
{
  "mcpServers": {
    "paystage": {
      "command": "node",
      "args": ["./node_modules/@paystage/mcp/dist/cli.js"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json",
        "PAYSTAGE_RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

- `PAYSTAGE_POLICY_PATH` (required): path to your local `policy.json`.
- `PAYSTAGE_RPC_URL` (optional): RPC endpoint used by on-chain checks. Defaults to a public Base RPC.

## Tools

| Tool | Status | What it does |
| --- | --- | --- |
| `evaluate_mcp_payment` | Available now | Evaluates a proposed x402 payment against the local policy and returns `pay`, `review`, or `do_not_pay`. |
| `list_outstanding_auths` | Available now | Lists payments that are authorized but not yet settled. |
| `evaluate_outstanding_auths` | Available now | Evaluates outstanding authorizations and flags double-pay or limbo risk. |
| `evaluate_hip3_trade` | Available now | Evaluates a proposed HIP-3 / trade.xyz order against a local TradePolicy (`allow` \| `review` \| `do_not_trade`). Not financial advice — local policy gate only. |
| `evaluate_velocity` | Available now | Rate and spend-pattern velocity checks against the local policy. |

## Packages

| Package | Role | Links |
| --- | --- | --- |
| `@paystage/mcp` | Umbrella MCP server (start here) | [npm](https://www.npmjs.com/package/@paystage/mcp) |
| `@paystage/preflight` | MCP payment preflight | [npm](https://www.npmjs.com/package/@paystage/preflight) |
| `@paystage/auth-watch` | Outstanding-auth watch | [npm](https://www.npmjs.com/package/@paystage/auth-watch) |
| `@paystage/policy` | Policy parsing and evaluation | [npm](https://www.npmjs.com/package/@paystage/policy) |
| `@paystage/trade-preflight` | HIP-3 / trade.xyz trade preflight | [npm](https://www.npmjs.com/package/@paystage/trade-preflight) |

## Links

- Website: https://paystage.xyz
- GitHub: https://github.com/base-buzz/paystage
- npm: https://www.npmjs.com/org/paystage

## Development

This is a monorepo.

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Contributing

PayStage is built in the open, and outside contributions are welcome.

- **Add a drainer address.** Open a PR adding it to `KNOWN_DRAINERS.md` with a public source link (incident report, explorer label, or security write-up). Unsourced addresses won't be merged.
- **Add an integration example.** LangChain, AgentKit, ElizaOS and others are all welcome.
- **Report a bypass.** If an unsafe payment gets past preflight, open an issue. That's the most valuable contribution there is.

Look for issues labelled `good first issue` to get started.

## License

MIT
