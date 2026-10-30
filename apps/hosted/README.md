# @paystage/hosted

Cloudflare Worker exposing the PayStage x402-protected evaluation API.

## Endpoints

| Environment | URL | Network | Facilitator |
| --- | --- | --- | --- |
| Mainnet | `https://api.paystage.xyz` | Base mainnet (`eip155:8453`) | Coinbase CDP |
| Testnet | `https://sepolia.api.paystage.xyz` | Base Sepolia (`eip155:84532`) | x402.org |

Price is `$0.002` per call on both networks.

## Facilitators

- **Testnet** uses the public x402.org facilitator (`https://x402.org/facilitator`), which is **testnet only**.
- **Mainnet** uses the Coinbase CDP facilitator (`https://api.cdp.coinbase.com/platform/v2/x402`) with auth headers derived from `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` via `@coinbase/x402`'s `createFacilitatorConfig`. Do **not** set `FACILITATOR_URL` for mainnet.

## Secrets

Set via `wrangler secret put <NAME>` (never commit values):

| Secret | Mainnet | Sepolia |
| --- | --- | --- |
| `PAYSTAGE_PAYTO` | required | required |
| `CDP_API_KEY_ID` | required | — |
| `CDP_API_KEY_SECRET` | required | — |

Mainnet deploy is **blocked** until `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are set on the Worker.

## Deploy

```sh
# Testnet
wrangler deploy --env sepolia

# Mainnet (requires CDP secrets to be set first)
wrangler deploy
```

## Tests

```sh
pnpm test        # unit tests (no CDP required)
pnpm typecheck
```

Paid e2e (Sepolia only) — see `scripts/e2e-instructions.md`.
