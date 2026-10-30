# E2E instructions (Base Sepolia)

No private keys belong in this file or anywhere in the repo.

## 1. Fund the dev payer

Payer (Dave): `0x552163d84229865Ca11f2860369239eCf0Eb9Dcb`

- Base Sepolia ETH: https://www.alchemy.com/faucets/base-sepolia
- Base Sepolia USDC: https://faucet.circle.com (select Base Sepolia)

## 2. Configure the worker

Set the treasury payee as a secret (not `[vars]`):

```
wrangler secret put PAYSTAGE_PAYTO
# value: 0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE
```

`PAYSTAGE_PRICE`, `PAYSTAGE_NETWORK`, and `FACILITATOR_URL` come from
`wrangler.toml` `[vars]`.

## 3. Run locally

```
wrangler dev
```

## 4. Confirm the paywall

Unpaid request should return HTTP 402 with an `accepts` array:

```
curl -i -X POST http://localhost:8787/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d '{"payment_required":{},"policy":{}}'
```

## 5. Pay and evaluate

Dave signs the x402 payment payload with his own key using any x402 client
(e.g. `@x402/fetch`), then retries the request with the `X-PAYMENT` header.
The worker verifies via the facilitator and returns the evaluation decision.

Do not commit Dave's key. Do not deploy to mainnet.
