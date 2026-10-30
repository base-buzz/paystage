Agents are going to pay for things. That's not a question anymore. The question is whether anything stands between the agent and the money before it moves.

Right now: nothing does.

---

An agent with a wallet and no policy gate will overpay. It will pay the wrong address. It will pay a lookalike listing. Not because it's malicious — because it has no reason not to.

"Should this payment happen?" is a question nobody was asking.

---

PayStage Preflight asks it. Before the agent signs an x402 payment, preflight checks it against a local policy and returns one of three verdicts:

pay
review
do_not_pay

That's it. A decision, before money moves.

---

The policy is a JSON file. Max amount. Payee allowlist. Allowed networks (Base mainnet, Base Sepolia). What to do with an unknown payee.

```
{
  "version": 1,
  "max_amount": { "value": "1.00", "asset": "USDC", "decimals": 6 },
  "allowed_pay_to": ["0x2096..."],
  "allowed_networks": ["eip155:8453", "eip155:84532"],
  "unknown_payee": "review"
}
```

---

It's an MCP server. stdio. Runs where your agent runs.

```
npx @paystage/preflight
```

Set PAYSTAGE_POLICY_PATH. Wire it into Claude Desktop or Cursor. Done.

---

x402 + USDC on Base + MCP is the stack agents will pay on. Preflight is the gate in front of it.

Available now on npm: @paystage/preflight

GitHub: github.com/base-buzz/paystage
Site: paystage.xyz

---

This is tool #1. More tools weekly: outstanding-auth watch is next, then a Farcaster approve mini-app, dead-seller watch, provenance receipts, micro-escrow.

Agents will pay. Make sure they pay the right people.
