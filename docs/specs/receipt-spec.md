# Verdict receipt — format, and two vectors you can check

A PayStage receipt binds a decision to the inputs that produced it, so a third party can
answer three questions without trusting us: *what was decided, over what, and when.*

Everything below is generated from the implementation in `apps/hosted/src/receipt.ts`, not
described from it. If the vectors stop matching, the format changed and this document is
wrong — that is the point of having them.

## Format

```json
{
  "v": 1,
  "issuer": "paystage",
  "issued_at": "2026-11-12T00:00:00.000Z",
  "service": { "name": "@paystage/hosted", "version": "0.3.4" },
  "verdict": { "decision": "pay", "reasons": [], "summary": "Decision: pay." },
  "request_sha256": "37172a4f…",
  "policy_sha256": "49f9c17b…",
  "signed": true,
  "alg": "ECDSA-P256-SHA256",
  "key_id": "paystage-receipt-v1",
  "signature": "base64url…"
}
```

| Field | Meaning |
|---|---|
| `v` | receipt format version. Bump only for a breaking change |
| `issued_at` | ISO-8601 UTC, when the verdict was computed |
| `service` | the build that produced it |
| `verdict` | `decision` is `pay` / `review` / `do_not_pay`; `reasons` are the rule texts |
| `request_sha256` | SHA-256 over the **canonical** request, lowercase hex |
| `policy_sha256` | SHA-256 over the **canonical** policy, lowercase hex |
| `signed` | `false` means no key was configured. Never a placeholder signature |

### Canonicalisation

JSON with **recursively sorted keys**, no insignificant whitespace, `undefined` omitted.
Two implementations must produce identical bytes or the digest is not reproducible.

```
canonical({"b":1,"a":[2,{"d":3,"c":4}]})  ==  {"a":[2,{"c":4,"d":3}],"b":1}
```

### What the signature covers

The **payload** — every field above except `signed`, `alg`, `key_id`, `signature`. Sign the
canonical form of the payload; verify against the same. `alg` is `ECDSA-P256-SHA256`, and
the key is published at `https://api.paystage.xyz/.well-known/paystage-receipt-key.json`.

## Vector 1 — an allowed payment

**Request** (canonical, exactly this string):

```json
{"accepts":[{"amount":"2000","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","maxTimeoutSeconds":300,"network":"eip155:8453","payTo":"0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE","scheme":"exact"}],"x402Version":2}
```

**Policy** (canonical):

```json
{"allowed_networks":["eip155:8453"],"allowed_pay_to":["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],"max_amount":{"asset":"USDC","decimals":6,"value":"0.05"},"max_timeout_seconds":300,"unknown_payee":"deny","version":1}
```

**Expected receipt:**

```json
{
  "v": 1,
  "issuer": "paystage",
  "issued_at": "2026-11-12T00:00:00.000Z",
  "service": { "name": "@paystage/hosted", "version": "0.3.4" },
  "verdict": { "decision": "pay", "reasons": [], "summary": "Decision: pay." },
  "request_sha256": "37172a4ff969ab46b7b4ef4735c7f41b9f10740f3821faf7a67b2bdf9342ff2f",
  "policy_sha256": "49f9c17bea2410e4a187ca1593cbdd4a5ff8e260fd280f44c10114d52fcf7bfb",
  "signed": false
}
```

Check it without our code:

```sh
printf '%s' "$CANONICAL_REQUEST" | sha256sum
# 37172a4ff969ab46b7b4ef4735c7f41b9f10740f3821faf7a67b2bdf9342ff2f  -
```

## Vector 2 — a denied payment

Same policy, same amount, **wrong payee** (`0x1111…1111`). The interesting property: the
policy digest is **unchanged** because the policy did not change. Only the request digest
moves.

```json
{
  "v": 1,
  "issuer": "paystage",
  "issued_at": "2026-11-12T00:00:00.000Z",
  "service": { "name": "@paystage/hosted", "version": "0.3.4" },
  "verdict": {
    "decision": "do_not_pay",
    "reasons": ["payTo 0x1111111111111111111111111111111111111111 not in allowed_pay_to (deny)"],
    "summary": "Decision: do_not_pay."
  },
  "request_sha256": "480300b1712bb50c30c8c89803cbf17a4ccc9d28193741612586ac1163e2a6ee",
  "policy_sha256": "49f9c17bea2410e4a187ca1593cbdd4a5ff8e260fd280f44c10114d52fcf7bfb",
  "signed": false
}
```

## Verifying a signed receipt

```sh
npx -y -p @paystage/mcp paystage-verify receipt.json
```

Exit codes are distinct on purpose, so a script can tell *forged* from *could not check*:

| Exit | Verdict | Means |
|---|---|---|
| 0 | `signed-and-valid` | signature verifies against the published key |
| 1 | `invalid` | signature present and does not verify — treat the receipt as forged |
| 2 | `unsigned` | no signature was produced; the digest is still checkable |
| 3 | `unverifiable` | the key could not be fetched. **Not** the same as valid |

Collapsing 3 into 0 would overstate what we know, which is why it has its own code.

## What this format does not prove

- **That the verdict was correct.** A receipt proves what we decided and over which inputs;
  it does not prove the policy was wise or the drainer list complete.
- **That the payment happened.** Settlement is a separate event on chain.
- **Who called us.** No caller identity is bound into the payload by design — we do not
  collect it, so we cannot attest to it.
