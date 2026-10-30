# @paystage/hosted

Hosted HTTP service for PayStage: x402-gated MCP payment evaluation and
outstanding EIP-3009 authorization checks.

## Endpoints

- `GET /health` — liveness.
- `POST /v1/evaluate_mcp_payment` — x402-protected. Body:
  `{ payment_required, policy }`. Returns a decision from
  `evaluatePayment(normalized, policy)`.
- `POST /v1/evaluate_outstanding_auths` — x402-protected. Body:
  `{ wallet, network?, tokens?, spenders?, policy, eip3009_nonces?, rpc_url? }`.
  Returns `{ listed, evaluated }`.

## Configuration

Environment variables (all `PAYSTAGE_*`):

- `PAYSTAGE_PAYTO` — treasury address that receives payments. **Set as a
  secret**, never in `[vars]` or source.
- `PAYSTAGE_PRICE` — x402 price string, e.g. `$0.002`.
- `PAYSTAGE_NETWORK` — CAIP-2 network, e.g. `eip155:84532` (Base Sepolia).
- `FACILITATOR_URL` — x402 facilitator endpoint.

### Treasury secret

The intended treasury `PAYSTAGE_PAYTO` is
`0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE`. Set it via:

```
wrangler secret put PAYSTAGE_PAYTO
```

Do **not** hardcode this address in payment logic — it is read from env only.
The deployer address `0x9cf6c7eBa6546998AFA1c1d8a9B124193a7cbe1e` is reserved
and not used at runtime.

## Faucets (Base Sepolia)

- ETH: https://www.alchemy.com/faucets/base-sepolia
- USDC: https://faucet.circle.com (select Base Sepolia)

## End-to-end testing

The dev payer is Dave at `0x552163d84229865Ca11f2860369239eCf0Eb9Dcb`. E2E
requires Dave's private key to sign the x402 payment payload — it is never
committed and never placed in this repo. See
`scripts/e2e-instructions.md`.

## Deployment

- Target: Cloudflare Workers (`wrangler dev` / `wrangler deploy`).
- **No mainnet deploy.** Base Sepolia only.
- `syncFacilitatorOnStart` is disabled (Workers have no long-lived process).
