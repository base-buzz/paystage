# Hosted "Try it" widget — spec

## Purpose

Give a human a one-click way to exercise the hosted PayStage x402 endpoint
(`POST /evaluate`) from the browser, end to end: see the `402 Payment Required`
challenge, sign an EIP-3009 authorization with their own wallet, retry, and read
the verdict. It is a demo of the payment flow, not a product surface and not
financial advice.

## UX

- Section `#try-it` on `https://paystage.xyz/`, after the Tools cards.
- Controls:
  - **Preset** `<select>`: `small_pay` (default), `over_limit`, `unknown_payee`.
    Selecting a preset fills the editable JSON body textarea.
  - **Body** `<textarea>`: the `evaluate_mcp_payment` request body
    (`payment_required` + `policy`, snake_case). Editable; invalid JSON is
    reported inline, never sent.
  - **Network** toggle: `Base Sepolia` (default) / `Base` (mainnet).
    Mainnet shows a persistent warning: *"Mainnet costs $0.002 real USDC per
    call."*
  - **Button**: `Connect wallet & run`.
  - **Output**: status line, verdict JSON (`decision`, `reasons`), and a
    settlement tx link to the matching explorer when a payment settled.
- Errors are surfaced as plain text: no wallet, wrong chain (offered a switch),
  insufficient funds (Sepolia → link to `https://faucet.circle.com`), user
  rejected the signature.

## x402 flow

1. `POST {api}/evaluate` with the JSON body and no payment header.
2. Server replies `402` with `PAYMENT-REQUIRED` (base64 JSON: `x402Version`,
   `accepts[]` with `scheme: "exact"`, `network`, `asset`, `payTo`, `amount`,
   `maxTimeoutSeconds`, `extra`).
3. Client picks the `accepts` entry matching the selected network, builds an
   EIP-712 `TransferWithAuthorization` (EIP-3009) typed-data payload, and asks
   the wallet to sign it via `eth_signTypedData_v4`. No transaction is sent and
   no key touches the page.
4. Client retries the same `POST` with the `X-PAYMENT` header (base64 payload).
5. Server verifies + settles through the facilitator, returns `200` with the
   verdict and `PAYMENT-RESPONSE` (base64 JSON with `transaction`, `network`).
6. Client decodes `PAYMENT-RESPONSE` and links the tx on the explorer.

The signing/retry loop is implemented once in `site/try-it/pay.js`
(`runPaidEvaluate`) using `@x402/evm`'s `wrapFetchWithPaymentFromConfig` +
`ExactEvmScheme`, so the browser widget and the Node harness share the same
code path.

## CORS

The Worker (`apps/hosted/src/app.ts`) mounts `hono/cors` first:

- `origin`: `https://paystage.xyz`, `https://www.paystage.xyz`,
  `http://localhost:4173`, `http://127.0.0.1:4173`
- `allowMethods`: `GET, POST, OPTIONS`
- `allowHeaders`: `Content-Type, Payment-Signature, X-PAYMENT,
  PAYMENT-SIGNATURE, Accept`
- `exposeHeaders`: `Payment-Required, Payment-Response, PAYMENT-REQUIRED,
  PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, payment-required, payment-response`
- `maxAge`: `86400`

`OPTIONS` preflight is answered by the CORS middleware and never reaches the
payment middleware or the evaluate route.

## Sepolia vs mainnet

- **Sepolia** (`eip155:84532`, `https://sepolia.api.paystage.xyz`) is the
  default. Test USDC only; get it from `https://faucet.circle.com`.
- **Mainnet** (`eip155:8453`, `https://api.paystage.xyz`) charges **$0.002 real
  USDC per call**. The toggle must show that warning before the button is
  usable. Do not deploy or demo mainnet paid flows as part of this work.

## Security

- No private keys, mnemonics, or secrets in the page, the bundle, or the repo.
- Signing happens in the user's wallet; the page only receives signatures.
- The Node harness reads a throwaway key from `PAYSTAGE_E2E_KEY_FILE` and never
  prints it.
- No logging of signatures, headers, or key material.
- Copy is neutral: no trading advice, no yield/return claims.

## Success criteria

- `OPTIONS /evaluate` from `https://paystage.xyz` returns `204`/`200` with
  `Access-Control-Allow-Origin` and `Access-Control-Expose-Headers` containing
  `payment-required` (case-insensitive).
- Existing hosted tests stay green.
- `site/try-it.bundle.js` builds from `site/try-it/entry.js` with esbuild.
- On Sepolia, `small_pay` with a funded throwaway key returns `200`, a
  `decision` of `pay`, and a tx hash linkable on `sepolia.basescan.org`.
- The Node harness exits non-zero on any failure and prints no secrets.