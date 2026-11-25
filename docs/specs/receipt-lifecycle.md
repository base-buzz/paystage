# The receipt lifecycle — what a seller can check in five minutes

A receipt from `offer-receipt` says a payment was **captured**. It says nothing about partial
delivery, a refund, or a payment that should never have settled. The lifecycle adds those
transitions as **separate signed statements** that name the original receipt:

```
authorised → captured → voided → refunded
```

`captured` is the receipt itself; `authorised`, `voided` and each partial `refunded` are statements.
Every state is signed with the same receipt key and the same canonical-JSON/ES256 envelope, and the
whole chain is checkable offline with the receipt plus the published key set — no database, no
network, no secret.

It is **not** a second format. A lifecycle statement is the receipt envelope with a lifecycle body:
every field except `signed`, `alg`, `key_id` and `signature` is the signed payload, exactly as for a
receipt. `verifyReceipt()` is unchanged, and `verifyChain()` checks each link by calling it.

## The object

The original receipt is never modified, so it still verifies on its own. A statement looks like this:

```json
{
  "v": 1,
  "kind": "paystage.receipt-lifecycle.v1",
  "state": "refunded",
  "at": "2026-11-20T12:10:00.000Z",
  "receipt": "9f2c…e1 (sha256 of the original receipt's canonical signed payload)",
  "amount": "400000",
  "reason": "partial delivery",
  "signed": true,
  "alg": "ECDSA-P256-SHA256",
  "key_id": "paystage-receipt-v1",
  "signature": "MEUCIQ…"
}
```

- **`state`** is one of `authorised`, `captured`, `voided`, `refunded`.
- **`at`** is when the transition was signed, ISO 8601. Statements are processed in the order given
  and must not go backwards in time.
- **`receipt`** is the digest a refund points at: SHA-256 over the original receipt's canonical
  signed payload, excluding the signature fields — the same id the receipt chain uses for `prev`.
- **`amount`** is atomic units as a string (the unit `ReceiptPayment.amount` already uses:
  `"400000"` is 0.40 USDC at six decimals). A `refunded` statement must carry one; the others may.
- **`key_id`/`signature`** are the receipt fields. The row's sketch calls the key field `kid`; the
  receipt envelope has always called it `key_id`, and reusing that name is what lets the existing
  verifier check the statement without a translation layer.

## What each state means

| state | meaning |
|---|---|
| `authorised` | The payer authorised the payment before it settled. Evidence only: it must be the first statement and must be timestamped no later than the receipt. It moves no money. |
| `captured` | Money settled. **The receipt is the capture**, so a chain always starts here; an explicit `captured` statement may restate it, with an amount that matches the receipt exactly. |
| `voided` | The payment should not be treated as delivered/settled. A void moves no money by itself; if funds were captured, a `refunded` statement returns them. |
| `refunded` | Money was returned. Partial refunds repeat the state until `remaining` reaches zero; a full refund takes `remaining` to zero. |

The lifecycle is a **state machine with signed transitions, not a bag of events**. The legal moves
are:

```
captured --refunded--> refunded --refunded--> refunded   (partial, until remaining = 0)
captured --voided----> voided ----refunded--> refunded
```

`voided` cannot follow `refunded`, and a refund cannot precede the capture (its `at` cannot be earlier
than the receipt's `issued_at`). Both are refused by the verifier, not left to the caller.

## How to verify it

```js
import { verifyReceipt, verifyChain } from "@paystage/receipt-verify";

// 1. The original receipt still verifies exactly as before.
const receiptCheck = await verifyReceipt(receipt, { jwk: receiptKey });

// 2. The chain: the receipt plus every statement you were given.
const chain = await verifyChain({ receipt }, statements, { keys: publishedJwks.keys });
if (!chain.ok) {
  // chain.status names the link that broke; chain.reason quotes the amounts.
} else {
  // chain.captured / chain.refunded / chain.remaining are atomic-unit strings.
}
```

A statement was signed with `issueLifecycle()` or `refund()`:

```js
import { refund } from "@paystage/receipt-verify";
const partial = await refund(
  receipt,
  { amount: "400000", reason: "partial delivery" },
  { signingKeyPkcs8B64: process.env.RECEIPT_SIGNING_KEY, kid: "paystage-receipt-v1" },
);
```

## Failure statuses

`verifyChain()` returns `{ ok: true, captured, refunded, remaining, state }` or a discriminated
failure. It never throws, and it never reports an unverifiable chain as valid.

| `status` | meaning |
|---|---|
| `missing-original` | No original receipt was supplied, or a statement names a different receipt digest. |
| `unsigned` | The original receipt or a statement carries no signature, or the supplied key set has no key for its `key_id`. |
| `tampered` | The signature does not match the payload — the statement was altered or signed by a different key. |
| `malformed` | Unknown version/kind/state, unreadable timestamp, non-integer or zero amount, a `refunded` statement with no amount, or an explicit `captured` amount that contradicts the receipt. |
| `illegal-transition` | The statements are out of order: `voided` after `refunded`, a refund before the capture, an `authorised` statement after capture or not first, a duplicate `captured`/`voided`, or timestamps that run backwards. |
| `amount-exceeds-captured` | A refund is larger than what remains captured (the reason quotes `captured`, `refunded` and the amount refused). |
| `already-refunded` | Nothing remains; a second full refund is refused here, not silently accepted. |

## What a seller must check

1. **The original receipt first.** `verifyReceipt()` against the published receipt key set, with the
   payment terms you expect. The lifecycle is only as good as the receipt it points at.
2. **Every statement, not just the last one.** `verifyChain()` checks the statements you supply. A
   refund you were never shown cannot be counted, so a buyer who hides an earlier refund could make
   the arithmetic look open. Ask for the full chain, and treat an incomplete one as incomplete.
3. **The asset and decimals.** The chain works in the receipt's atomic units. It does not compare
   assets, networks or decimals; confirm the receipt's `payment.asset` is the one you expect before
   reading any amount.
4. **The arithmetic.** `remaining = captured − refunded`. A chain is `ok` only while no refund
   exceeds what remains. Read `remaining` as "not yet refunded", not as "still owed".
5. **Freshness is a separate question.** `verifyChain()` does not re-apply the receipt's
   `expires_at`: that stamp bounds acting on the *decision*, not refunding a payment that already
   settled. If your policy needs a fresh receipt, run `verifyReceipt()` with `now` as well.
6. **Fail closed.** `unsigned`, `tampered` and `missing-original` all mean the transition is not
   proven. An unverifiable statement must never be read as a refund.

## What it is not

**No arbitration, no reversal by a third party.** This format records and proves what the signing
key holder said about a payment; nobody can force money back through it. It is finality plus an
honest refund path.

## What a verified refund does not prove

It does not prove that the transfer happened on-chain, that the seller will send it (or has sent
it), that the refund reached the right person, or that the buyer's software obeys the chain. It
proves one thing: the holder of the key named by `key_id` signed this amount against this receipt at
this time, and — given the statements supplied — the arithmetic and the state order are consistent.

## Where the code is

- Lifecycle types, `issueLifecycle`/`refund`, `verifyLifecycleEvent`, `verifyChain`:
  [`packages/receipt-verify/src/lifecycle.ts`](../../packages/receipt-verify/src/lifecycle.ts)
- The envelope it reuses (unchanged): [`packages/receipt-verify/src/verify.ts`](../../packages/receipt-verify/src/verify.ts)
- The issuer side of the receipt: [`apps/hosted/src/receipt.ts`](../../apps/hosted/src/receipt.ts)
- Tests: [`packages/receipt-verify/tests/lifecycle.test.ts`](../../packages/receipt-verify/tests/lifecycle.test.ts)
