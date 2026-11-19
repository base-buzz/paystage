# @paystage/n8n

The PayStage payment gate as an n8n node. One operation: **evaluate a proposed x402 payment** before your workflow signs it,
and get back `pay`, `review` or `do_not_pay` with the rule that fired.

No credentials, no wallet, no keys. The node calls the hosted endpoint, so a workflow gets the same gate an agent does.

## Why this exists

n8n workflows already move money — a trigger, an HTTP call, a settlement step. What they do not have is the one question that
matters between "the workflow decided" and "the money moved": **should this payment be signed?** This node asks it.

## Install

```bash
npm install @paystage/n8n
```

Then enable community nodes in your n8n instance and add **PayStage** to a workflow.

## What it returns

The verdict is returned as data, not thrown as an error — a workflow usually wants to branch on a refusal rather than fail:

| decision | meaning |
|---|---|
| `pay` | within policy, no sanctions or drainer match — sign it |
| `review` | a human should look first |
| `do_not_pay` | refused, with `reasons[]` naming the rule |

If the gate cannot be reached the node returns `decision: "unverifiable"` and `fail_closed: true`. **It never returns `pay`
because a request failed** — a gate that fails open is not a gate.

## Not included: receipt verification

Checking a signed receipt belongs on your machine: that is the point of a signature, and a hosted verify endpoint would ask you
to trust the same server that issued it. Use [`@paystage/mcp`](https://www.npmjs.com/package/@paystage/mcp)'s
`paystage-verify` CLI or its `verify_receipt` tool — both work offline.

## Limits

Same as the API it calls: exact-address checks against public lists, no hop or exposure analysis, EVM only, and absence of a
flag is not evidence a payee is safe. The lists and their provenance are published at [paystage.xyz/lists](https://paystage.xyz/lists).
