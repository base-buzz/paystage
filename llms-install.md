# Installing PayStage — for agents and for the humans configuring them

PayStage is an MCP server that answers one question before an agent's wallet signs an x402
payment: **should this payment happen?** Tools return `pay`, `review` or `do_not_pay`, with
the rule that fired.

## The command

```sh
npx -y -p @paystage/mcp paystage-mcp
```

Two bins are published (`paystage-mcp` and `paystage-verify`), so `npx @paystage/mcp` on its
own cannot infer which one to run and fails with *"could not determine executable to run"*.
Use `-p` and name the bin.

## Client configuration

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`) use the same
shape:

```json
{
  "mcpServers": {
    "paystage": {
      "command": "npx",
      "args": ["-y", "-p", "@paystage/mcp", "paystage-mcp"],
      "env": { "PAYSTAGE_POLICY_FILE": "/absolute/path/to/policy.json" }
    }
  }
}
```

`PAYSTAGE_POLICY_FILE` is optional. Without it the server starts and answers
`do_not_pay` for anything it cannot judge, rather than guessing — a gate with no policy is
not a permissive gate.

## The five tools

| Tool | Answers |
|---|---|
| `evaluate_mcp_payment` | should an MCP tool call be paid for |
| `evaluate_outstanding_auths` | should an existing EIP-3009 authorisation be settled |
| `list_outstanding_auths` | what authorisations exist for an address |
| `evaluate_hip3_trade` | does a proposed HIP-3 trade fit the policy (it never places one) |
| `evaluate_velocity` | is this agent's rate or spend pattern normal |

## Verify it installed

```sh
npx -y -p @paystage/mcp paystage-verify --help
```

And to prove the server answers, send it a JSON-RPC `initialize` followed by `tools/list`
over stdio. The repository ships `scripts/mcp-handshake.mjs`, which does exactly that and
asserts five tools come back.

## Without installing anything

```sh
curl -s -X POST https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d '{"payment_required":{"x402Version":2,"accepts":[…]},"policy":{…}}'
```

Returns a real verdict, signed receipt included, with no payment and no account for the
first 1,000 calls per IP per day. A browser demo of the same call is at
<https://paystage.xyz/try>.

## What it does not do

- does not hold keys, sign transactions, or move funds
- does not place orders or recommend trades — the trade tool is a local policy gate
- does not see what happens after settlement; it decides before the signature exists

Source, tests and the receipt format: <https://github.com/base-buzz/paystage>
