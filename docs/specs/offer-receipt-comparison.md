# Receipt Envelope Comparison: PayStage vs x402 offer-receipt

| Field (ours) | Field (theirs) | Same/different/missing |
|---|---|---|
| `v` | — | missing on theirs |
| `issuer` | — | missing on theirs |
| `issued_at` (ISO-8601) | `issuedAt` (Unix timestamp) | different |
| `service` { `name`, `version` } | — | missing on theirs |
| `verdict` { `decision`, `reasons`, `summary` } | — | missing on theirs |
| `request_sha256` | — | missing on theirs |
| `policy_sha256` | — | missing on theirs |
| `signed` (boolean) | signed via JWS/EIP-712 | different |
| `alg` ("ECDSA-P256-SHA256") | JWS ES256 / EIP-712 | different |
| `key_id` | `kid` (JWS) | different |
| `signature` (base64url) | JWS signature (base64url) | different |
| `prev` ("genesis" / 64-hex) | — | missing on theirs |
| `expires_at` (optional, ISO-8601) | — | missing on theirs |
| `payment` { `scheme`, `network`, `asset`, `amount`, `payee` } (optional) | — | missing on theirs |
| — | `resourceUrl` | missing on ours |
| — | `payer` (wallet address) | missing on ours |
| — | `network` (blockchain network) | missing on ours |
| — | `txHash` (optional, if `includeTxHash: true`) | missing on ours |

**Verdict:** Our envelope is **incompatible** with theirs — neither is a subset of the other; they carry largely different information (decision binding vs proof-of-interaction).

**Deliberate differences.** The sentences below are quoted from `apps/hosted/src/receipt.ts` (the implementation's
header, which states the rules) and `docs/specs/receipt-spec.md` where marked — the first draft of this page attributed
all five to the spec, which was wrong for four of them:

- "Never change a verdict. The receipt wraps the decision; it does not influence it. `evaluate` stays the only authority." We include a `verdict` object with `decision`, `reasons`, and `summary` to explicitly record the decision and rationale, whereas their receipt carries no decision field.

- "Deterministic. The same inputs must canonicalize to the same bytes, or a third party cannot reproduce the digest." We include `request_sha256` and `policy_sha256` so third parties can verify the exact inputs that produced the verdict, a capability their receipt does not provide.

- "Honest when unsigned. With no key configured the receipt is emitted with `signed: false` and no signature — never a placeholder or a fake." We always emit `signed: false` when no signing key is configured, never a placeholder signature, whereas their scheme uses JWS/EIP-712 signatures that are always present when a signing key is set up.

- "Honest about provenance. `service.version` says which build produced the verdict, and falls back to `unknown` rather than `0.0.0`, because a placeholder that looks like a version is read as one." Our `service.version` falls back to the word `unknown` rather than `0.0.0`, so a value that could be mistaken for a release version never appears, whereas their receipt has no service identification field.

- `docs/specs/receipt-spec.md:55` — "A receipt may carry `prev` **inside the signed payload**": we support hash chaining via the `prev` field ("genesis" or 64-hex SHA-256 of the previous receipt), whereas their receipt format does not include a hash chain link.

**URL fetched:** `https://raw.githubusercontent.com/x402-foundation/x402/main/docs/extensions/offer-receipt.mdx` — HTTP status: 200