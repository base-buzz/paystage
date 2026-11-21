---
name: paystage-decode-challenge
description: Load when you receive a 402 or a PaymentRequired body and need to know what is being asked — price, payee, scheme, network — before deciding anything. Pure decoding, no network, no keys.
---

# Decode a 402 challenge

**Trigger:** an HTTP 402 or a `PaymentRequired` object arrived and you need to know what it actually
asks for. Also useful before `paystage-evaluate-payment`, because a challenge you cannot read is one you
should not pay.

```bash
npx -y -p @paystage/mcp paystage-decode-payment-required challenge.json
```

## What to look at, in order

1. **payee** — who receives. Compare against the host in the URL; a mismatch is the
   host-versus-payee bind problem, not a detail.
2. **amount** — and its share of the budget you were given.
3. **scheme and network** — `exact` on `eip155:8453` is Base mainnet. A testnet or an unfamiliar chain
   changes the risk, not just the address.
4. **asset** — the token, not the ticker. Symbols are not identities.

## Rules of engagement

1. Decoding is not approving. Nothing here says the payment is safe.
2. Report the fields you read, not a vibe: "900000 USDC base units to 0xabc…" beats "a payment request".
3. If a field is missing, that is a finding — say which one is absent rather than assuming a default.

## What this does not do

It makes no network calls and holds no keys. It cannot tell you whether the payee is honest.
Related: `paystage-evaluate-payment` for the verdict, `paystage-verify-receipt` afterwards.
