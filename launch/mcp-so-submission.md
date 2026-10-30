# mcp.so submission — draft

## Title

PayStage Preflight

## Short description

MCP payment preflight for x402. Checks a proposed payment against a local policy and returns pay, review, or do_not_pay before the agent signs.

## Long description

PayStage Preflight is a stdio MCP server that sits in front of an agent's wallet. Before an agent signs an x402 payment, it asks PayStage Preflight whether the payment should happen.

The server evaluates the proposed payment (amount, asset, network, payee) against a local JSON policy file and returns one of three verdicts:

- `pay` — within policy; the agent may proceed.
- `review` — outside auto-approve bounds; a human or higher-level check should decide.
- `do_not_pay` — violates policy; the agent must not sign.

The policy file is plain JSON with snake_case keys. It supports a maximum single payment amount, an explicit payee allowlist, an allowed-network list (CAIP-2, e.g. `eip155:8453` for Base mainnet and `eip155:84532` for Base Sepolia), and a configurable verdict for unknown payees.

Example policy:

```
{
  "version": 1,
  "max_amount": { "value": "1.00", "asset": "USDC", "decimals": 6 },
  "allowed_pay_to": ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  "allowed_networks": ["eip155:8453", "eip155:84532"],
  "unknown_payee": "review"
}
```

Set the policy path with the `PAYSTAGE_POLICY_PATH` environment variable.

This is tool #1 from PayStage. It is early stage and focused: it does not custody funds, does not sign transactions, and does not run a hosted service. It returns a verdict; the agent (or its wallet layer) decides what to do with it.

## Categories / tags

MCP, x402, payments, USDC, Base

## Install command

```
npx @paystage/preflight
```

## Links

- npm: https://www.npmjs.com/package/@paystage/preflight
- GitHub: https://github.com/base-buzz/paystage
- Website: https://paystage.xyz
- MCP Registry name: `xyz.paystage/preflight`
