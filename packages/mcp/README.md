# @paystage/mcp

PayStage umbrella MCP server: payment preflight + outstanding-auth watch.

One stdio MCP server that registers every PayStage tool. Future tools are added
in a single place (`registerAllTools` in `src/server.ts`).

## Quick start

```bash
npx -y @paystage/mcp
```

## Tools

| Tool | Description |
| --- | --- |
| `evaluate_mcp_payment` | Evaluate an x402 `PaymentRequired` payload against a PayStage spending policy before paying. |
| `list_outstanding_auths` | List outstanding token authorizations (EIP-3009 / allowances) for a wallet. |
| `evaluate_outstanding_auths` | List outstanding token authorizations and evaluate them against a policy. |

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PAYSTAGE_POLICY_PATH` | No | Path to a PayStage policy JSON file. Defaults to `./policy.json`. |
| `PAYSTAGE_RPC_URL` | No | RPC URL used for on-chain reads. Defaults to a public Base RPC. |

## Claude Desktop / Cursor config

Add to your MCP client config (e.g. `claude_desktop_config.json` or Cursor's
`mcp.json`):

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

## License

MIT
