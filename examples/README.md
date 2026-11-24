# Runnable examples

One command, four verdicts, no network and no keys:

```bash
npm run build -w @paystage/preflight   # once, from the repo root
node examples/run.mjs
```

```
policy: examples/policies/strict.json  (0.05 USDC cap, one allowed payee, deny unknowns)

  case            decision       reason
  over-cap        do_not_pay     amount 12.5 USDC exceeds max_amount 0.05 USDC
  unknown-payee   do_not_pay     payTo 0x6160a0d8… not in allowed_pay_to (deny)
  drainer         do_not_pay     known drainer
  allowed         pay            —
```

This is a demo **and** a test: `run.mjs` asserts each expected verdict and exits non-zero if one changes, so CI
notices when the product's behaviour moves. That is deliberate — an example that only prints is documentation;
one that fails is a check.

## What is here

| Path | What it is |
|---|---|
| `policies/strict.json` | one policy: 0.05 USDC cap, a single allowed payee, unknown payees denied, and `step_up` above 0.01 USDC or for a new payee |
| `challenges/*.json` | four x402 v2 payment challenges, one per interesting outcome |
| `run.mjs` | evaluates each challenge against the policy and asserts the verdict |

`run.mjs` also supplies the payer's recorded history for the allowed case, because the novelty step-up is a
function of what the payer has done before; without history, a payee is treated as unseen (see
[`docs/why-preflight.md`](../docs/why-preflight.md)).

## Why these four cases

They are the four things that actually happen to an agent in the wild:

- **over-cap** — the seller raised its price after the policy was written
- **unknown-payee** — a seller the policy has never heard of
- **drainer** — a payee on the cited deny list
- **allowed** — the happy path, so a reader can see what "fine" looks like

## Next steps

- Hosted, no clone: [`docs/seller-protection.md`](../docs/seller-protection.md) — the same idea with `curl`.
- What this cannot catch: [`LIMITS.md`](../LIMITS.md).
