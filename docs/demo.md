# The gate decides before anything is signed

One command, three verdicts, no network. It reads the same x402 v2 challenge fixtures the
[examples](../examples/) use and runs them through `@paystage/preflight`'s `evaluatePayment` — the
evaluator the seller endpoint and the buyer-side guard both call.

```bash
npm run build -w @paystage/preflight   # once
node scripts/demo-decision.mjs
```

Actual output, copied from the command on 2026-11-23:

```text
PayStage gate demo — a 402 challenge, decided before anything is signed
Offline: fixture challenges and policy only. No network, no keys, no payment header.

policy: examples/policies/strict.json (review case overrides unknown_payee=review)
case        verdict      rule                          challenge
pay         pay          none                          examples/challenges/allowed.json
            2000 atomic USDC on eip155:8453 to 0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE
            reason: none — no rule blocked the payment
review      review       accept.payee_allowlist        examples/challenges/unknown-payee.json
            2000 atomic USDC on eip155:8453 to 0x6160a0d8a3a1f8b0c4e2d1f7b3a9c6e5d4f23757
            reason: payTo 0x6160a0d8a3a1f8b0c4e2d1f7b3a9c6e5d4f23757 not in allowed_pay_to (review)
do_not_pay  do_not_pay   accept.max_amount             examples/challenges/over-cap.json
            12500000 atomic USDC on eip155:8453 to 0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE
            reason: amount 12.5 USDC exceeds max_amount 0.05 USDC

3/3 verdicts as expected. Nothing was signed.
```

## What each case shows

- **pay** — `allowed.json` names the allowlisted payee at 0.002 USDC. Every policy check passed, so no rule
  fired and the seller may advertise its 402.
- **review** — `unknown-payee.json` names a payee the allowlist does not contain; under
  `unknown_payee: "review"` the gate stops and asks a human instead of refusing or paying. The rule id is
  `accept.payee_allowlist`.
- **do_not_pay** — `over-cap.json` asks 12.5 USDC against a 0.05 cap; `accept.max_amount` fires and the
  challenge never reaches a signer.

The script exits `1` if a verdict changes, and names the fixture it cannot read, so the transcript cannot
silently become fiction.

## What removing the gate does

With the gate call present, `createSeller({ priceAtomic: "20000" })` answers an unpaid request:

```text
over-cap price, gate present -> 403
x-paystage-verdict: do_not_pay
x-paystage-rule: accept.max_amount
{"error":"blocked_by_gate","message":"blocked-by-rule: accept.max_amount","rule":"accept.max_amount","verdict":"do_not_pay","reasons":["amount 0.02 USDC exceeds max_amount 0.01 USDC"]}
gate calls: 1
```

Remove the `gate(challenge)` call in a temporary copy (not committed) and the same request advertises the
over-cap 402 and accepts a payment:

```text
no payment header -> 402
with payment header -> 200
summary: hello
gate calls: 0
```

So the claim is falsifiable: the gate is what turns an over-cap 402 into a 403 before any payment header is
read. `examples/seller/seller.test.mjs` asserts that 403, so removing the call also turns the suite red.

## What this demo cannot show

- It does not start a seller or send an HTTP request; the 402 bodies are fixtures. The HTTP path is covered
  by `node --test examples/seller/seller.test.mjs`.
- It does not verify a payment signature, call a facilitator, or move funds. No key exists on this path.
- It does not prove the evaluator is complete. It proves these three fixtures produce these verdicts.
- It shows no real payment, real stranger, or on-chain hash, so it does not meet the original row's
  "recorded demo with a transaction hash" scope. It is the offline decision clip, not the payment clip.
