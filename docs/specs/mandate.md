# The mandate object — what a seller can check in five minutes

A mandate is a **signed, scoped, revocable authority**: one identity (the *principal*) grants another
(the *agent*) permission to pay a seller under stated limits. It is a document the seller verifies
before serving, not a promise inside the buyer's software.

It is deliberately not a receipt. A receipt says *what was decided*; a mandate says *what the agent is
allowed to do next*. Both use the same signing scheme and the same published key, so a seller needs
one key set, not two.

## The object

```json
{
  "v": 1,
  "serial": "vch_7F3…",
  "principal": "Northwind Ltd",
  "agent": "shopping-agent-7",
  "scope": {
    "per_payment": "2.00",
    "window_amount": "20.00",
    "window_seconds": 86400,
    "allowed_payees": ["0x2096…287C"]
  },
  "issued_at": "2026-11-01T00:00:00.000Z",
  "expires_at": "2026-12-01T00:00:00.000Z",
  "revocable": true,
  "kid": "paystage-receipt-v1",
  "signature": "MEUCIQ…"
}
```

- **`principal`** is the identity granting the authority. **`agent`** is the identity receiving it.
  They must be different; a mandate where they are the same is a permission slip the agent wrote for
  itself, and `issue()` refuses it.
- **`scope.per_payment`** and **`scope.window_amount`** are decimal strings in whole units of the
  payment asset (`"2.00"` = 2.00 USDC), not atomic units.
- **`scope.window_seconds`** is a rolling window: settled payments newer than
  `now − window_seconds` count toward `window_amount`.
- **`scope.allowed_payees`** is optional. Omitted means any payee.
- **`revocable`** says whether the principal offers a revocation path before expiry. It is information
  for the seller, not a switch the seller controls.
- **`signature`** is an ES256 signature over every other field except `kid` and `signature` —
  canonical JSON with sorted keys, base64url WebCrypto `r||s`. This is the receipt scheme
  ([`apps/hosted/src/receipt.ts`](../../apps/hosted/src/receipt.ts),
  [`packages/receipt-verify`](../../packages/receipt-verify)), not a second one.
- **There is no asset or chain field in v1.** The seller supplies the asset's decimals when checking
  the scope and must separately confirm the asset and network it expects. See "What it does not
  prove".

## How to verify it

Verification is offline: a mandate plus the published key set. No database, no network call, no secret.

```js
import { verify } from "@paystage/mandate";

const result = await verify(mandate, {
  keys: publishedJwks.keys,        // the receipt JWKS, selected by kid
  revocations,                      // optional: signed statements you have seen
  now: new Date(),                  // optional: injectable clock
});

if (!result.ok) {
  // result.status is one of the values below, and result.reason says why.
}
```

| `status` | meaning |
|---|---|
| `unsigned` | no signature field; it records a claim, it does not prove a grant |
| `malformed` | unsupported version, missing field, unreadable amount or timestamp |
| `unknown-kid` | the key set has no key for this `kid`; an unverifiable mandate is **not** valid |
| `tampered` | the signature does not match the payload, or a matching revocation is not validly signed |
| `revoked` | a valid revocation statement names this serial |
| `expired` | signed and genuine, but `expires_at` has passed |
| `ok: true` | the signature proves the payload; it is unexpired and not revoked |

`verify()` never throws. "I could not check this" is a different answer from "this is forged", and
neither is ever reported as valid.

## Revocation is a separate signed statement

The mandate is immutable and signed, so revoking it does not edit it. `revoke()` signs a statement
that names the serial:

```json
{ "v": 1, "serial": "vch_7F3…", "revoked_at": "2026-11-20T09:00:00.000Z",
  "reason": "lost device", "kid": "paystage-receipt-v1", "signature": "MEUCIQ…" }
```

A revoked bundle that needs re-signing is a revocation that can be lost in a queue; a statement is
additive, independently verifiable, and can travel on any channel. `verify()` accepts the statements
you have seen as `revocations`; an invalid statement that names the serial fails closed as `tampered`
rather than letting the mandate read as live.

## What a seller must check

1. **The signature and the key.** Run `verify()` against the published receipt key set. Treat
   `unknown-kid` exactly like `tampered`.
2. **The identities.** Confirm `principal` is the party you expect and `agent` is a different party.
   Both are self-asserted labels; see the limit below.
3. **The clock.** `verify()` checks `expires_at` against *your* clock, not the issuer's.
4. **The payment against the scope.** Use [`evaluateMandate()`](../../packages/mandate/src/evaluate.ts)
   with the payment amount in atomic units, the payee and the asset's decimals. Feed it the payments
   already settled inside the window. A refusal names the rule that failed — `per-payment`, `window`,
   `payee`, `expiry` or `revoked` — and quotes the numbers, so it is actionable.
5. **The asset and network.** The mandate does not name them. A "2.00" cap is meaningless if you
   read it against a token with different decimals or a different asset.
6. **A revocation feed, when `revocable` is true.** If you never look, a revoked mandate looks active.

The hosted lookup (`GET /v1/mandate/:serial`) answers `unknown` for every serial until a writer
records one; `unknown` means do not trust the pass. Offline verification of a mandate you were handed
does not depend on that endpoint.

## What a verified mandate does not prove

A verified mandate does not prove that the seller will deliver, that the caps are enforced on-chain
(#437), or that the holder of the key is the person you think.

It also does not prove that the agent has actually spent less than the window (the evaluator needs a
spend history you supply), that the mandate was issued by a legal entity behind `principal`, or that
the buyer's software obeys the scope when it is not the one talking to you. It proves one thing: the
holder of the key named by `kid` signed these exact limits for this exact serial at this time.

## Where the code is

- Envelope, `issue` / `verify` / `revoke`: [`packages/mandate/src/envelope.ts`](../../packages/mandate/src/envelope.ts)
- Scope evaluation and rule names: [`packages/mandate/src/evaluate.ts`](../../packages/mandate/src/evaluate.ts)
- Types and constants: [`packages/mandate/src/types.ts`](../../packages/mandate/src/types.ts)
- Evaluator integration: [`packages/preflight/src/evaluate.ts`](../../packages/preflight/src/evaluate.ts) (`EvaluateOptions.mandate`)
- Public lookup route: [`apps/hosted/src/routes/mandate.ts`](../../apps/hosted/src/routes/mandate.ts)
