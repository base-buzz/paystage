# Check a seller before your agent pays — five minutes, no install

The problem this solves is narrow and common: an agent is about to pay an x402 seller, and nobody has checked
whether the price is the one agreed, whether the payee is the address you meant, or whether that address is on a
known-drainer list. Every step below runs on the free tier with `curl` and `node`. Nothing to install.

Replace `SELLER_URL` with the endpoint your agent is paying.

## 1. Get the challenge the seller sends

Any x402 seller answers an unpaid request with a `payment-required` header holding a base64 JSON challenge.

```bash
curl -si -X POST "$SELLER_URL" -H 'content-type: application/json' -d '{}' \
  | grep -i '^payment-required:' | cut -d' ' -f2 | tr -d '\r' \
  | base64 -d > challenge.json
```

You now have the seller's terms: scheme, network, asset, **atomic amount**, payee and timeout.

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "amount": "12500000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x6160a0d8a3a1f8b0c4e2d1f7b3a9c6e5d4f23757",
    "maxTimeoutSeconds": 300
  }]
}
```

## 2. Write one policy file

This is the whole configuration. It says: USDC on Base only, at most 0.05 per payment, and only to payees you
have verified.

```json
{
  "version": 1,
  "max_amount": { "value": "0.05", "asset": "USDC", "decimals": 6 },
  "allowed_assets": [{ "symbol": "USDC", "decimals": 6, "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "network": "eip155:8453" }],
  "allowed_networks": ["eip155:8453"],
  "allowed_pay_to": ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
  "max_timeout_seconds": 300,
  "unknown_payee": "deny"
}
```

`unknown_payee: "deny"` is the important line. Everything not on the list is refused, which is the opposite of
how most allow-lists are written and the reason this works when the seller is new.

## 3. Ask for a verdict — free, no account

```bash
cat > ask.json <<'JSON'
{ "payment_required": <contents of challenge.json>, "policy": <contents of the policy above> }
JSON

curl -s -X POST https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -H 'x-paystage-source: test' \
  -d @ask.json
```

A real response for the challenge above, with that policy:

```json
{
  "decision": "do_not_pay",
  "reasons": ["amount 12.5 USDC exceeds max_amount 0.05 USDC"],
  "receipt": { "signed": true, "expires_at": "2026-11-16T01:30:48.360Z", "...": "..." }
}
```

**Stop here.** The seller asked for 12.5 USDC against a 0.05 ceiling, and the rule that fired is named. No key
was used, nothing was signed, no funds moved.

## 4. The allowed case

Change the amount to `2000` (0.002 USDC) and the payee to the one your policy lists:

```json
{ "decision": "pay", "reasons": [], "receipt": { "...": "..." } }
```

`pay` means "this payment is within the policy you wrote" — not "this seller is trustworthy". See
[LIMITS.md](../LIMITS.md) for what a verdict cannot tell you.

## 5. Keep the receipt

Every verdict comes with a signed receipt bound to the payment terms and valid for five minutes. Verify it
without trusting the server:

```bash
npx -y -p @paystage/mcp paystage-verify receipt.json
```

```
VALID — signature matches the payload
  verdict:   pay
  issued_at: 2026-11-16T01:25:51.425Z
  key_id:    paystage-receipt-v1
```

`INVALID` means the payload was altered. `UNVERIFIABLE` means the key could not be fetched — which is a refusal,
not a pass.

## Where this still fails

- a seller that is real, honest-looking, and simply does not deliver — no address check catches that
- a payment your agent makes outside this path
- a policy you write too permissively

All three are in [LIMITS.md](../LIMITS.md), in the same words we would use to a customer.
