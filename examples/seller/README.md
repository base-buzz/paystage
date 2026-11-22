# Copyable x402 seller endpoint

One file: [`seller.mjs`](seller.mjs). One paid route. No framework, no database, no facilitator, no
hosting.

**this endpoint uses our gate because we wrote it that way; it is an example, not a service we host.**

It is a reference file to copy, not a product. There is no pricing service, no deployment, and no
support promise attached to it.

## What the file does, in order

1. **The gate runs first.** Before a `402` challenge is advertised and before any payment header is
   read, the challenge goes through `evaluatePayment` from `@paystage/preflight` — the same evaluator
   `@paystage/x402-guard` calls on the buyer side. A `review` or `do_not_pay` returns `403` with
   `blocked-by-rule: <rule>` (for example `blocked-by-rule: accept.max_amount`) and the
   `x-paystage-rule` header. Nothing is served and nothing is charged.
2. **The challenge is real x402.** It carries an `accepts` block on `eip155:8453` with Base USDC,
   `payTo` from `PAY_TO`, and an amount equal to the measured median.
3. **The Bazaar metadata has an input schema.** `extensions.bazaar` contains `info.input` (method,
   body shape) and the JSON Schema that describes it, plus `routeTemplate: /paid/summarize`. An
   indexer that requires a schema can invoke the route; one without it cannot.
4. **`payment-identifier` is declared and honoured.** Send the header (16–128 characters of
   `[A-Za-z0-9_-]`). A repeat of the same id returns the exact same bytes and the same receipt, with
   `x-paystage-idempotent-replay: true`. The seller records **one** simulated settlement, not two.
5. **The price is the measured median.** `$0.009` (9,000 atomic USDC) from the 2026-11-22 supply
   snapshot: 13,305 Base-USDC rows, median 9,000. The server prints whether it used a snapshot, the
   env var, or the built-in measured fallback.
6. **The receipt verifies.** It uses the existing PayStage receipt format, is signed with an ephemeral
   **test** P-256 key generated at startup, served at `/receipts/<id>`, and its public key is served at
   `/.well-known/paystage-receipt-key.json`. `@paystage/receipt-verify` checks it with no network.

## Run it

From the repo root:

```bash
PAY_TO=0x209693Bc6afc0C5328bA36FaF03C514EF312287C node examples/seller/seller.mjs
curl -i -X POST http://127.0.0.1:8402/paid/summarize \
  -H 'content-type: application/json' -d '{"text":"hello"}'
```

The first request returns `402` with the challenge. The tests below do the paid round trip, because a
real client would normally build the x402 payment header.

## The only environment variable you must set

| Variable | Required | Meaning |
|---|---|---|
| `PAY_TO` | **yes** | The 20-byte hex payee address in the `accepts` block. |
| `PORT` | no | Defaults to `8402`. |
| `MEDIAN_ATOMIC` | no | Overrides the measured median. The server prints `env:MEDIAN_ATOMIC`. |
| `SELLER_SUPPLY_SNAPSHOT` | no | Path to a supply snapshot to compute the median from. |

## Median: source and value

The measurement is in this repo only when the snapshot is present at
`docs/state/supply/2026-11-22.json`; otherwise the server looks at
`/work/ops/docs/state/supply/2026-11-22.json` during development and then falls back to the stated
built-in value. It always prints which source it used.

- Snapshot: `2026-11-22.json`, 24,799 rows.
- Filter: `network === "eip155:8453"` and the Base USDC asset.
- Rows: 13,305.
- **Median: 9,000 atomic USDC = `$0.009`.**

If you copy this file, replace that measurement with your own price. Pricing at the median is a
default for an example, not a recommendation.

## Idempotency

Key: the `payment-identifier` request header, or `payload.extensions["payment-identifier"].info.id` in
the payment payload. The cache lives in memory for ten minutes. The first request issues a receipt and
increments the simulated-settlement counter; a repeat returns the cached status, body and receipt,
adds `x-paystage-idempotent-replay: true`, and does not increment it.

## Receipt fields

`v`, `issuer`, `issued_at`, `expires_at`, `service`, `verdict`, `payment`, `request_sha256`,
`policy_sha256`, `signed`, `alg`, `key_id`, `signature`.

- `request_sha256` covers the **exact `402` body** you received, so a third party can reproduce it.
- `policy_sha256` covers the gate policy in the file.
- `payment` binds scheme, network, asset, amount and payee.
- `key_id` is `seller-example-test-key-v1`; `alg` is `ECDSA-P256-SHA256`.

The key is generated at startup and is **not** a PayStage identity and not a production key. Restart
the server and earlier receipts stop verifying; that is correct for a test key. No key material is
committed.

Verify the served receipt with the package the project publishes:

```js
import { verifyReceipt } from "@paystage/receipt-verify";
const verdict = await verifyReceipt(receipt, {
  keyUrl: "http://127.0.0.1:8402/.well-known/paystage-receipt-key.json",
  expectedRequest: challengeBody,
  expectedPolicy: policy,
  payment: { scheme: "exact", network: "eip155:8453", asset: USDC, amount: "9000", payee: PAY_TO },
});
// => { ok: true, status: "signed-and-valid", ... }
```

## Tests (including the one that keeps the gate in place)

```bash
node --test examples/seller/seller.test.mjs
```

The critical case starts a seller priced at `$0.02` against the `$0.01` cap. It asserts the refusal
is `403` with `blocked-by-rule: accept.max_amount`, both before and after a payment header. Remove the
gate call and that request becomes a `402`/`200`; the test goes red. Other cases assert the receipt
verifies, a repeat is byte-identical with one simulated settlement, and the whole flow runs with
`globalThis.fetch` replaced by a thrower.

## What is not real

- **Settlement is simulated.** The example parses a payment header and checks that its `accepted`
  fields match the challenge. It does not verify an EIP-3009 signature, call a facilitator, or move
  funds. Do not run it with money.
- **No chain, no RPC, no network.** There is no wallet, no key beyond the ephemeral receipt test key,
  and no on-chain transaction.
- **No support, no hosting, no pricing service.** Copy it and own it.

## Copy it

1. Copy `seller.mjs`.
2. Set `PAY_TO`.
3. Change `PAID_PATH`, the Bazaar schemas and the handler to your own route.
4. Install the two existing packages the file imports: `@paystage/preflight` (the gate) and
   `@paystage/receipt-verify` (receipt canonicalisation and verification). No other dependency is
   needed.
