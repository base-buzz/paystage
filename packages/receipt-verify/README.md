# @paystage/receipt-verify

Verify a PayStage verdict receipt **without installing the server**. Two inputs: the receipt, and a fetch of the published JWKS. No keys, no signing, no `@paystage/mcp`.

A receipt says a decision was made, over these inputs, at this time. This package is the path that turns that sentence into something a third party can check: parse the receipt, select the signing key by `kid` from the published key set, verify the ES256 signature, then check expiry and — when you supply the payment in front of you — the payment binding. It returns the same verdict shape as `@paystage/mcp`'s `verifyReceipt`, so the status strings are not a second vocabulary.

## Usage

```js
import { verifyReceipt } from "@paystage/receipt-verify";

const receipt = await (await fetch("https://api.paystage.xyz/v1/evaluate_mcp_payment", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ payment_required, policy }),
})).json().then((body) => body.receipt);

const verdict = await verifyReceipt(receipt, {
  // Optional: check that this receipt is about the payment you are holding.
  payment: { scheme, network, asset, amount, payee },
});

if (verdict.ok) {
  console.log(verdict.status, verdict.verdict); // "signed-and-valid" pay | review | do_not_pay
} else {
  console.log(verdict.status, verdict.reason);
}
```

The key is fetched from `https://api.paystage.xyz/.well-known/paystage-receipt-key.json`. Override `keyUrl` to pin a copy, or pass `jwk` to verify against a key you already hold; `key_source` in the result says which was used.

```js
// Fully offline: supply the key yourself.
const verdict = await verifyReceipt(receipt, { jwk });
```

## Verdict statuses

| status | `ok` | meaning |
|---|---|---|
| `signed-and-valid` | `true` | signature proves the payload; expiry and payment binding passed |
| `invalid` | `false` | bad signature, unsupported version, bad `alg`, malformed timestamp or signature |
| `expired` | `false` | signed and genuine, but `expires_at` has passed |
| `payment-mismatch` | `false` | genuine, but it is about a different payment (or predates binding) |
| `stale` | `false` | genuine, but older than the `maxAgeSeconds` bound you set |
| `inputs-mismatch` | `false` | genuine, but its digests do not cover `expectedRequest` / `expectedPolicy` |
| `unsigned` | `false` | no signature, so it cannot prove who decided it |
| `unverifiable` | `false` | the key could not be fetched, or the receipt names a `kid` the issuer does not publish |

An unknown `kid` fails closed: it is `unverifiable`, never a guess at another key. This verifier is ES256-only (ECDSA P-256 + SHA-256); it rejects any other key or receipt algorithm rather than following the issuer to a new one silently.

## Tests

```sh
npm test -w @paystage/receipt-verify
```

Tests are offline: throwaway keys are generated in-process and the JWKS response is stubbed. One fixture is a real receipt captured from the live hosted endpoint, verified against a snapshot of the published JWKS with the clock pinned just after issue.

MIT.
