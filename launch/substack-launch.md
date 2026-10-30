# Agents will pay. Make sure they pay the right people.

Agents are getting wallets. That part is settled. x402 gives them a way to pay for things over HTTP, USDC on Base makes the money real and cheap to move, and MCP gives them a standard way to call tools. Put those together and you get agents that can transact on their own.

What you also get is agents that can pay the wrong amount to the wrong address, and nothing in the stack stops them.

That's the gap PayStage is built for. Today we're shipping tool #1.

## The problem

An agent with a wallet and no policy gate has no reason to hesitate. It will pay a price it was quoted. It will pay an address it was given. It will pay a listing that looks right. If the quote is inflated, the address is a lookalike, or the listing is a copy, the agent doesn't know. It just pays.

Humans have friction here. We read the amount, we recognize the name, we get a bad feeling. Agents don't get bad feelings. They need an explicit check that runs before the money moves and returns a decision they can act on.

## What shipped

**PayStage Preflight** — an MCP server that evaluates a proposed x402 payment against a local policy and returns one of three verdicts:

- `pay` — within policy; the agent may proceed.
- `review` — outside auto-approve bounds; a human or higher-level check should decide.
- `do_not_pay` — violates policy; the agent must not sign.

It's a stdio MCP server. It runs where your agent runs. It doesn't custody funds, doesn't sign transactions, and doesn't call home. It returns a verdict; the agent or its wallet layer decides what to do with it.

It's published on npm as `@paystage/preflight` version 0.1.0.

## How it works

You write a policy file. It's plain JSON, snake_case keys, no DSL:

```
{
  "version": 1,
  "max_amount": { "value": "1.00", "asset": "USDC", "decimals": 6 },
  "allowed_pay_to": ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  "allowed_networks": ["eip155:8453", "eip155:84532"],
  "unknown_payee": "review"
}
```

A few things worth calling out:

- `max_amount` caps a single payment. `value` is a decimal string, `asset` is the symbol, `decimals` is the asset's precision. No floating-point surprises.
- `allowed_pay_to` is an explicit allowlist. If the payee isn't on it, the `unknown_payee` verdict applies — here, `review`.
- `allowed_networks` uses CAIP-2 identifiers. `eip155:8453` is Base mainnet, `eip155:84532` is Base Sepolia. If the payment targets a network you didn't list, it doesn't get a `pay`.

The agent calls preflight with the proposed payment. Preflight reads the policy, evaluates the payment, and returns the verdict. That's the whole loop.

## Install

```
npx @paystage/preflight
```

Set `PAYSTAGE_POLICY_PATH` to the absolute path of your policy file. Wire it into Claude Desktop or Cursor as an MCP server. The README has config snippets for both.

## What's next

This is tool #1 of a set. The next one is **Outstanding-auth watch**: payments that are authorized but never settled. That's the failure mode where an agent authorizes a payment, the settlement doesn't land, and the agent — having no memory of the gap — pays again. Watching for it is the fix.

After that: a Farcaster approve mini-app for approving pending payments from a phone, dead-seller watch for payees that stop settling, MCP listing provenance receipts, micro-escrow, and a publish-and-register one-shot.

One tool a week. Small, focused pieces that compose into a payment safety layer.

## Links

- npm: https://www.npmjs.com/package/@paystage/preflight
- GitHub: https://github.com/base-buzz/paystage
- Website: https://paystage.xyz

Agents will pay. The least we can do is make sure they pay the right people.
