```
# @paystage/hosted

Cloudflare Worker exposing the PayStage x402-protected evaluation API.

## Endpoints

| Environment | URL | Network | Facilitator |
| --- | --- | --- | --- |
| Mainnet | `https://api.paystage.xyz` | Base mainnet (`eip155:8453`) | Coinbase CDP |
| Testnet | `https://sepolia.api.paystage.xyz` | Base Sepolia (`eip155:84532`) | x402.org |

Both endpoints are live. Price is `$0.002` per call on both networks.

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
| `MANDATE_MINT_TOKEN` | only to mint mandates | only to mint mandates |
| `MANDATE_TENANT_ID` | only to mint mandates | only to mint mandates |

No private keys are stored in the Worker. `PAYSTAGE_PAYTO` is the treasury address that receives USDC; the CDP secrets are only used to authenticate to the facilitator.

## Minting a mandate

`POST /v1/mandate` records a signed mandate envelope so `GET /v1/mandate/:serial` can answer with a
status instead of `unknown`. It is not part of the paid evaluation API and not behind x402: it is
gated by the service token `MANDATE_MINT_TOKEN` (`Authorization: Bearer …`) and writes only into the
tenant `MANDATE_TENANT_ID`. Unset either one and every mint is refused with `503
mandate_mint_not_configured` — there is no open default. The envelope is verified against the receipt
key set (`RECEIPT_SIGNING_KEY_PKCS8`), so a deployment that signs no receipts cannot mint either.
Caller rule, response shape and the named refusals: [`docs/specs/mandate.md`](../../docs/specs/mandate.md#minting-a-mandate--post-v1mandate-455).

## Deploy

```sh
# Testnet
wrangler deploy --env sepolia

# Mainnet
wrangler deploy
```

## Tests

```sh
pnpm test        # unit tests (no CDP required)
pnpm typecheck
```

Paid e2e (Sepolia only) — see `scripts/e2e-instructions.md`. Do **not** run mainnet paid e2e from a throwaway testnet key.
```

## Try it

Live demo: <https://paystage.xyz/#try-it>

Build the Try-it bundle:

```sh
npm run build:try-it
```

Run the Sepolia harness (uses the same browser module as the widget):

```sh
PAYSTAGE_E2E_KEY_FILE=/path/to/sepolia-throwaway.key \
  node scripts/try-it-sepolia-harness.mjs
```

The harness only touches Base Sepolia (`eip155:84532`) and never prints the
private key — only the derived address.
