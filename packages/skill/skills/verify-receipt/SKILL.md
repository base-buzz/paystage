---
name: paystage-verify-receipt
description: Load when you have a PayStage receipt or someone hands you one, and you need to know whether it is genuine before trusting or forwarding it. Verifies a signature offline against a published key.
---

# Verify a receipt

**Trigger:** anything that mentions a receipt, a verdict record, or "prove what you decided" — including
when a third party hands you one and asks you to believe it.

## Why it matters

A receipt is a claim until the signature checks. An unverifiable receipt is not evidence, it is a story
with a hash in it — say so plainly rather than forwarding it.

```bash
npx -y -p @paystage/mcp paystage-verify receipt.json
```

Against a published key the receipt names, or a key you supply:

```bash
npx -y -p @paystage/mcp paystage-verify receipt.json --key key.json
```

## Reading the answer

- `signed-and-valid` — the payload is intact and the key is the one that signed it.
- `unsigned` — a record of a decision, proving nothing about who made it.
- `invalid` — the payload was altered after signing. Do not act on it; treat it as a tampering signal.
- `unverifiable` — the key could not be fetched or the format is unknown. **Not** the same as invalid:
  say "I could not check", never "it is fake".

## Rules of engagement

1. Never describe an unchecked receipt as verified.
2. Keep `key_id` apart from trust: the payload names a key, the key proves provenance.
3. If the key rotates, receipts signed before it must still verify — if they do not, that is the finding.

## What this does not do

It does not tell you whether the decision was *right*, only whether it was really made. Related:
`paystage-evaluate-payment` before signing, `paystage-decode-challenge` to read the challenge.
