# Starter — three clients, one verdict

The fastest path from "what is this" to "I saw it refuse a payment". Every path below reaches the same endpoint and
the same answer; the only edit is your wallet or payee.

**Nothing here needs a wallet to see a verdict.** Run this first:

```bash
node starter/check.mjs
```

```
mcp:      9 tools (evaluate_mcp_payment, list_outstanding_auths, evaluate_outstanding_auths…)
verdict:  do_not_pay — amount 12.5 USDC exceeds max_amount 0.05 USDC
starter: endpoint answers, nine tools, one real verdict — no wallet needed for this much
```

CI runs that file, so these instructions cannot quietly stop working.

## 1. Claude Code

```bash
claude mcp add --transport http paystage https://api.paystage.xyz/mcp
```

Or copy [`claude-code/.mcp.json`](claude-code/.mcp.json) into your project root. Then, in a session:

> Use the paystage tool to evaluate a 12.5 USDC payment on Base to `0xc64a71e150cd21ebc4b12695850bed6b067743bc`
> against a policy capping payments at 0.05 USDC. Show the verdict and the rule that fired. Do not sign anything.

Expect `do_not_pay` with `amount 12.5 USDC exceeds max_amount 0.05 USDC` and no signature.

## 2. Cursor

Copy [`cursor/mcp.json`](cursor/mcp.json) into `.cursor/` and reload. The same prompt produces the same verdict.

## 3. AgentKit

AgentKit owns the wallet; PayStage owns the decision. [`agentkit/agent.ts`](agentkit/agent.ts) registers the gate on
the client hook so it runs on **every** payment, not only when the model remembers:

```bash
npm i @paystage/x402-guard x402-fetch
```

Edit `allowed_pay_to`, and the same policy is enforced before anything is signed.

## The point of three paths

The interesting difference is not syntax, it is *position*: an MCP tool is called when the agent decides to call it,
while a client hook runs whether it would have or not. Both are in here so you can pick the one that matches how much
you trust your own agent. See [`LIMITS.md`](../LIMITS.md) — an agent that signs outside these paths is not covered by
either.
