# @paystage/preflight

Evaluate an [x402](https://x402.org) `PaymentRequired` against a local spending
policy **before** your agent pays. Returns one of three verdicts: `pay`,
`review`, or `do_not_pay`.

- **Local-first** — policy lives in a JSON file on your machine. No secrets, no
  network calls to decide.
- **MCP-native** — runs as a stdio MCP server so Claude Desktop, Cursor, and any
  MCP client can call it as a tool.
- **Deterministic** — same input + same policy ⇒ same verdict.

## Install

Run directly with `npx` (no global install):

```bash
npx -y @paystage/preflight
```

Or add it to your MCP client config.

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paystage-preflight": {
      "command": "npx",
      "args": ["-y", "@paystage/preflight"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json"
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "paystage-preflight": {
      "command": "npx",
      "args": ["-y", "@paystage/preflight"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json"
      }
    }
  }
}
```

## Example `policy.json`

```json
{
  "version": 1,
  "name": "standard",
  "allowed_networks": ["eip155:8453", "eip155:84532"],
  "allowed_assets": [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  ],
  "allowed_pay_to": ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  "max_amount_per_call": "1.00",
  "max_amount_per_session": "10.00",
  "require_human_above": "0.50",
  "max_timeout_seconds": 300,
  "default_verdict": "review"
}
```

Amounts are human-readable USDC (e.g. `"0.50"` = 0.50 USDC). Networks use
CAIP-2 identifiers.

## Verdicts

| Verdict       | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `pay`         | Within policy — safe to proceed automatically.                          |
| `review`      | Allowed but above a human threshold — ask a human before paying.        |
| `do_not_pay`  | Violates policy (network, asset, payTo, amount, timeout, or malformed). |

## Links

- Website: <https://paystage.xyz>
- Source: <https://github.com/base-buzz/paystage>
- License: MIT
