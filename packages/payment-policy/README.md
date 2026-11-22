# `@paystage/payment-policy`

Try the draft policy format without adopting our gate.

This is a reference implementation of the `payment-policy` extension draft
(x402-foundation/x402#4279), written so the document can be tried before the draft merges.
It is the **document** half only: it emits the policy an x402 server would publish, parses one
a client received, and classifies the client's advisory verdict. It does not choose payments,
does not sign, and does not move money. `private: true` — nothing is published until the spec
merges.

## The document

The draft puts the policy at `PaymentRequired.extensions["payment-policy"].info`:

```json
{
  "version": 1,
  "rules": {
    "max_amount": { "value": "1.00", "asset": "USDC", "decimals": 6 },
    "allowed_networks": ["eip155:8453"],
    "allowed_assets": [
      { "symbol": "USDC", "decimals": 6, "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "network": "eip155:8453" }
    ],
    "allowed_pay_to": ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
    "max_timeout_seconds": 60,
    "unknown_payee": "review"
  }
}
```

`rules` is the `@paystage/policy` v1 body with `version` lifted one level. This package depends
on `@paystage/policy` and validates with its `PolicySchema`; it does not copy or rename the
vocabulary. Every field the shared schema accepts — including `daily_cap`,
`require_human_above`, `time_window`, `agents` and the authorisation fields — survives the
round-trip.

## API

```ts
import { emitPolicy, parsePolicy, evaluateVerdict } from "@paystage/payment-policy";

const text = emitPolicy(policy);        // canonical JSON text of the `info` object
const parsed = parsePolicy(text);       // validated Policy from @paystage/policy
const info = JSON.parse(text);          // embed at extensions["payment-policy"].info

evaluateVerdict({ decision: "do_not_pay", rule_id: "allowed_pay_to" }, parsed);
// → "do_not_pay"
```

- `emitPolicy(policy)` — validate, lift `version`, and serialise **canonically**: keys sorted,
  no incidental whitespace, array order preserved. Same policy, same bytes.
- `parsePolicy(document)` — accept the canonical text or the object, validate against
  `@paystage/policy`, return a `Policy`. Unknown fields are refused with their name rather than
  silently stripped.
- `evaluateVerdict(verdict, policy?)` — return one of `"pay"`, `"review"`, `"do_not_pay"`,
  `"unsupported"`.
- `policyDocument(policy)` — the same document as a live object, for callers that want to embed
  it without a parse step.
- `serializePolicyDocument(document)` — canonical text from an already-built document.

## The four verdicts

The draft's `verdict.decision` enumerates **three** words, used here verbatim:

| verdict | meaning |
|---|---|
| `pay` | the client decided to pay |
| `review` | a human or agent must look before signing |
| `do_not_pay` | the client will not pay |

`unsupported` is the package's fourth return, and it is **not a protocol value**. It means the
verdict cannot be trusted: a decision outside the three words above, a malformed field, or a
`rule_id` that does not resolve in the supplied policy. A `rule_id` with no policy supplied is
also `unsupported`, because an uncheckable rule reference is not evidence. The draft does not
name this fourth outcome; the package names it rather than guessing a decision.

`rule_id` is resolved as a dotted path into `rules`, so it uses the schema's own field names:
`allowed_pay_to`, `unknown_payee`, `velocity.windows.max_count`. Arrays are transparent, so the
last spelling also matches a window in `velocity.windows[]`. One limitation is inherent to a
dotted path: an `agents` overlay key that itself contains a dot cannot be addressed unambiguously
by a `rule_id`, even though the document preserves the key.

## What the draft got wrong

Building this against `@paystage/policy` found three mismatches in the draft, all fixed in the
draft rather than worked around in the parser:

1. **`velocity` shape.** The example used `{ window_seconds, max_count, max_amount }`; the
   shared schema has always required `{ windows: [ ... ] }`. The example did not validate. The
   draft now shows the array shape, and a test pins the old example's exact failure.
2. **`unknown_payee` vocabulary.** The draft listed `"pay" | "review" | "do_not_pay"`; the
   schema says `"review" | "deny"`. The draft now uses the schema's words.
3. **Required fields.** The draft's table described `max_amount`, `allowed_networks`,
   `allowed_assets`, `allowed_pay_to`, `max_timeout_seconds` and `unknown_payee` as optional
   with defaults; the schema requires them. The table now says so. (The document format still
   needs a decision from the draft's authors on whether the extension should allow absence;
   this package follows the implementation it is seeded from.)

The draft's verdict and refusal examples also named `allowlist.payTo` and `velocity.max_count`,
neither of which resolves against the schema's fields; they now read `allowed_pay_to` and
`velocity.windows.max_count`.

## Guarantees and limits

- **Proved:** `parsePolicy(emitPolicy(policy))` deep-equals the policy for every fixture, and
  `emitPolicy(parsePolicy(document))` returns each canonical document fixture byte-for-byte.
  One fixture exercises every field `@paystage/policy` v1 accepts.
- **Not claimed:** this evaluates payment terms or produces the verdict's `decision`. That is
  the gate's job (`@paystage/preflight` / `@paystage/x402-guard`); this package only carries
  the document and classifies a verdict against it.
- **Not a credential.** A verdict is advisory in the draft; `evaluateVerdict` never upgrades one
  to authorisation, and a server must not gate access on it.

No filesystem access, no network access, no shell, no telemetry: strings and objects in,
strings and objects out.

## Test

```bash
npm test -w @paystage/payment-policy
npm run typecheck -w @paystage/payment-policy
```
