# @paystage/eliza-plugin

Payment safety for [elizaOS](https://github.com/elizaOS/eliza) agents: **one action** that asks whether a proposed x402 payment
should be signed, and **one provider** that says which policy is active.

Returns `pay`, `review` or `do_not_pay` with the rule that fired. No keys, no signing, no network — the evaluator runs locally, so a
refusal costs nothing and works offline.

## Why

An agent can read a 402 challenge, decide the arithmetic looks fine, and sign a transfer to a stranger. Nothing in the stack asks a
different question — *should* this payment be signed? This plugin asks it, immediately before signing.

## Use

```ts
import { paystagePlugin } from "@paystage/eliza-plugin";

const paystage = paystagePlugin({ policy: myPolicy }); // or set PAYSTAGE_POLICY in the runtime settings
```

The action accepts a message whose `content.paymentRequired` is the decoded x402 v2 challenge, and returns:

| field | meaning |
|---|---|
| `data.decision` | `pay`, `review` or `do_not_pay` |
| `data.reasons` | one sentence per rule that fired |

**Fail-closed by design.** No policy configured → `review` with "refusing to guess a spend ceiling", rather than a default allow. A
malformed challenge → `review`, not `pay`.

## What it deliberately does not do

No memory, no embeddings, no character changes, no opinion about which payment *you* want to make. A plugin that does more than the
gate is a plugin people turn off.

## Limits

Exact-address checks against public lists, no hop or exposure analysis, EVM only, and absence of a flag is not evidence a payee is
safe. Lists and provenance: [paystage.xyz/lists](https://paystage.xyz/lists).
