# Verdict receipts

Every successful `POST /v1/evaluate_mcp_payment` returns a `receipt` alongside the
verdict. The receipt binds the decision to the exact inputs that produced it, so a
verdict can be checked later without re-running the evaluation and without
trusting this service's word for it.

```json
{
  "decision": "do_not_pay",
  "reasons": ["payTo is a known drainer"],
  "receipt": {
    "v": 1,
    "issuer": "paystage",
    "issued_at": "2026-11-09T06:40:12.001Z",
    "service": { "name": "@paystage/hosted", "version": "0.0.0" },
    "verdict": { "decision": "do_not_pay", "reasons": ["..."], "summary": "..." },
    "request_sha256": "…64 hex…",
    "policy_sha256": "…64 hex…",
    "signed": true,
    "alg": "ECDSA-P256-SHA256",
    "key_id": "paystage-receipt-v1",
    "signature": "base64url…"
  }
}
```

## What it proves, and what it does not

Proves: this service, at this time, on this service version, decided `decision`
for a payment request whose canonical form hashes to `request_sha256`, under a
policy whose canonical form hashes to `policy_sha256`.

Does **not** prove the policy was a good one, that the drainer list was current,
or that the caller supplied the inputs it claims. A receipt is an accounting
record, not an audit.

## Canonicalization

Both digests are SHA-256 over a canonical JSON form: object keys sorted,
`undefined` members dropped, no insignificant whitespace. The same function
(`canonicalize` in `src/receipt.ts`) produces the signed bytes, and it is exported
so a verifier does not have to reimplement it — mismatched canonicalization is the
most common way receipt verification silently fails.

## Verification

1. `GET /v1/public/receipt-key.json` → `{ configured, alg, key_id, jwk }`.
2. Strip `signed`, `alg`, `key_id`, `signature` from the receipt.
3. `canonicalize` the remainder, ECDSA-P256-SHA256 verify with the JWK.

`verifyReceipt()` in `src/receipt.ts` does exactly this and returns
`valid | invalid | unsigned | malformed`; `apps/hosted/tests/receipt.test.ts`
covers the happy path, a tampered verdict, a stripped signature, and a malformed
key.

## Signing key

`RECEIPT_SIGNING_KEY_PKCS8` — a PKCS#8 base64 ECDSA P-256 private key, set as a
Worker secret. Provision it once:

```sh
openssl ecparam -name prime256v1 -genkey -noout -out receipt-key.pem
openssl pkcs8 -topk8 -nocrypt -in receipt-key.pem -outform DER | base64 -w0 > receipt-key.pkcs8.b64
npx wrangler secret put RECEIPT_SIGNING_KEY_PKCS8 --config apps/hosted/wrangler.toml
```

Then publish the public half (the endpoint does it automatically) and store the
private key in the password manager. Rotating it changes `jwk`; keep `key_id`
stable until verifiers support multiple keys.

## Signed vs unsigned — stated, never faked

With no key configured, receipts are emitted with `signed: false` and **no
signature field**. There is no placeholder signature and no "trust us" flag.
`/v1/public/receipt-key.json` answers `{ configured: false }` in that state, so a
verifier learns the truth in one request.

## Not yet

- Local `@paystage/preflight` runs do not emit receipts. That is the next step and
  it needs a local key story; the hosted path ships first because the accounting
  question ("what did my agent spend and why") is asked by the operator, not the
  agent.
- Reasons are free-text strings, not structured rule ids. Binding a receipt to a
  named rule is the change that makes "which rule fired" machine-checkable; it
  touches `packages/preflight` evaluation output and therefore needs review.
