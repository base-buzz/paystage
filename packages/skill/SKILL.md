---
name: paystage
description: Check an x402 payment against a policy before signing it. Use whenever an agent is about to pay an HTTP 402 challenge, is told to "just pay", or receives a 402 it does not recognise. Returns pay, review or do_not_pay with the rule that fired.
---

# PayStage — check before you sign

You are about to spend money. Before any signature, evaluate the challenge.

## The one rule

**Never sign a payment the evaluator has not returned `pay` for.** `review` means stop and ask the
human. `do_not_pay` means refuse and say which rule fired.

## How to call it

The hosted endpoint needs no key and no signup:

```bash
curl -s https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d '{"payment_required": <the 402 challenge>, "policy": <the operator policy>}'
```

MCP clients can use the server instead:

```bash
npx -y -p @paystage/mcp paystage-mcp          # stdio
# or connect to https://api.paystage.xyz/mcp  (Streamable HTTP)
```

## What a verdict looks like

```json
{ "decision": "do_not_pay", "reasons": [{ "code": "payee_not_allowed", "detail": "…" }] }
```

Quote the reason code back to the human. It is the only part that explains *why*, and it is the
part a policy fix acts on.

## Rules of engagement

1. **A missing policy is not permission.** If no policy exists, ask for one — do not invent limits.
2. **Do not retry a `do_not_pay` with a changed amount.** That is the attack the gate exists for.
3. **Do not pay to learn.** The evaluation is free; settlement is not.
4. **Report the verdict, not just the outcome.** "Paid" without the decision is unauditable.

## What this does not do

It does not hold keys and cannot sign. It does not know what the seller does after payment. Post-
settlement reversals and off-chain promises are outside its scope, and saying so is part of using
it honestly.
