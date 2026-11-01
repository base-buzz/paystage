# PayStage

Safety tools for AI agent payments (x402 + MCP).

PayStage sits in front of an agent's wallet and answers one question before money moves: should this payment happen? Tools return `pay`, `review`, or `do_not_pay`.

## Quick start

## Quick start

You can run the umbrella MCP server (@paystage/mcp, including 4 tools like `evaluate_hip3_trade`) via `npx` or install it locally using npm:

```bash
# Option 1: Run instantly with npx
npx -y @paystage/mcp

# Option 2: Install locally via npm
npm install @paystage/mcp
```

`@paystage/mcp` 0.2.0 is the umbrella MCP server (4 tools including `evaluate_hip3_trade`). It exposes the PayStage tools over stdio and reads a local policy file.

## Listed on

- [mcp.so](https://mcp.so/server/paystage)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=xyz.paystage)
- [npm](https://www.npmjs.com/package/@paystage/mcp)
- [GitHub](https://github.com/base-buzz/paystage)

## Configure

Update your `claude_desktop_config.json` (or Cursor config) based on your installation method:

### Using npx:
```json
{
  "mcpServers": {
    "paystage": {
      "command": "npx",
      "args": ["-y", "@paystage/mcp"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json",
        "PAYSTAGE_RPC_URL": "https://base.org"
      }
    }
  }
}
```

### Using local npm install:
```json
{
  "mcpServers": {
    "paystage": {
      "command": "node",
      "args": ["./node_modules/@paystage/mcp/dist/index.js"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json",
        "PAYSTAGE_RPC_URL": "https://base.org"
      }
    }
  }
}

## Tools

| Tool | Status | What it does |
| --- | --- | --- |
| `evaluate_mcp_payment` | Available now | Evaluates a proposed x402 payment against the local policy and returns `pay`, `review`, or `do_not_pay`. |
| `list_outstanding_auths` | Available now | Lists payments that are authorized but not yet settled. |
| `evaluate_outstanding_auths` | Available now | Evaluates outstanding authorizations and flags double-pay or limbo risk. |
| `evaluate_hip3_trade` | Available now | Evaluates a proposed HIP-3 / trade.xyz order against a local TradePolicy (`allow` \| `review` \| `do_not_trade`). Not financial advice — local policy gate only. |

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
