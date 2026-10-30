# Hosted E2E — Base Sepolia (live Worker)

Short end-to-end check against the live hosted Worker. Dave holds the keys;
never ask for, paste, or commit any private key or secret.

## 1. Fund the payer

Payer: `0x552163d84229865Ca11f2860369239eCf0Eb9Dcb`

- ETH (gas): https://www.alchemy.com/faucets/base-sepolia
- USDC: https://faucet.circle.com (select **Base Sepolia**)

## 2. Live URLs (Base Sepolia only)

- https://api.paystage.xyz
- https://paystage-hosted.basebuzz69.workers.dev

## 3. Health check

```
curl https://api.paystage.xyz/health
```

Expect: `{"ok":true}`

## 4. Unpaid request → 402

```
curl -i -X POST https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d '{"payment_required":{},"policy":{}}'
```

Expect:

- HTTP `402`
- A `payment-required` header containing base64-encoded JSON with:
  - `payTo` = `0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE`
  - `network` = `eip155:84532`
  - `amount` = `2000` (i.e. `$0.002` USDC)

## 5. Paid retry (on Dave's machine only)

On Dave's own machine, using his own key:

1. Decode the `payment-required` challenge from step 4.
2. Sign the x402 payment payload with his key using any x402 client
   (e.g. `@x402/fetch`).
3. Retry the request with the `payment-signature` / `X-PAYMENT` header.

The Worker never sees Dave's key — it only verifies the signed payload.

## Notes

- Base Sepolia only. No mainnet.
- No secrets in this file or anywhere in the repo.
