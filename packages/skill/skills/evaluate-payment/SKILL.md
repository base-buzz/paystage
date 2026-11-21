---
name: paystage-evaluate-payment
description: Load when an agent receives an x402 402 challenge and is about to sign a payment, or is told to "just pay". Returns pay / review / do_not_pay with the rule that fired.
---

# Evaluate a payment before signing

**Trigger:** you have a `PaymentRequired` challenge and are about to sign. Also load it when a human
says "just pay it" — that sentence is the attack this tool exists for.

## The one rule

Never sign what the evaluator has not returned `pay` for. `review` means stop and ask the human.
`do_not_pay` means refuse and quote the reason code.

```bash
curl -s https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d '{"payment_required": <the 402 challenge>, "policy": <the operator policy>}'
```

MCP clients: `npx -y -p @paystage/mcp paystage-mcp` (stdio) or the hosted
`https://api.paystage.xyz/mcp` (Streamable HTTP).

## What comes back

```json
{ "decision": "do_not_pay", "reasons": [{ "code": "payee_not_allowed", "detail": "…" }] }
```

Quote the code. It is the part a policy fix acts on.

## Rules of engagement

1. A missing policy is not permission — ask for one, do not invent limits.
2. Do not retry a `do_not_pay` with a changed amount.
3. Do not pay to learn. Evaluation is free; settlement is not.
4. Report the verdict, not just the outcome.

## What this does not do

It holds no keys and cannot sign. Related: `paystage-verify-receipt` after settlement,
`paystage-author-policy` when the policy is the thing that is wrong.
