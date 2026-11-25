# @paystage/x402-guard

The ten lines between *"the agent decided to pay"* and *"the money moved."*

`x402-fetch` runs the payment loop well: request, read the 402, sign, retry. What it does
not do is ask **whether that payment should happen**. This wraps it, evaluates your policy
against the actual challenge, and refuses before the wallet signs.

## The whole change

```diff
-const res = await fetch("https://api.example.com/paid");
+const res = await guarded("https://api.example.com/paid");
```

Two lines, one call site. The `policy` below is configuration you write once; the guard only
changes how the request is made.

```sh
npm install @paystage/x402-guard x402-fetch   # v1, unscoped: takes a signer (see "two packages" below)
```

> **Published with provenance.** Every version from `0.1.1` onward is built and signed by this
> repository's CI (`npm view @paystage/x402-guard dist.attestations` shows it). The one exception is
> `0.1.0`, which was published by hand on 2026-11-12 before the Trusted Publisher existed and carries
> no attestation — pin `>=0.1.1` if that matters to your policy.

```ts
import { guardFetch } from "@paystage/x402-guard";
import { privateKeyToAccount } from "viem/accounts";

const guarded = guardFetch(fetch, {
  walletClient: account,
  policy: {
    version: 1,
    max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
    allowed_pay_to: ["0x…"],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x…", network: "eip155:8453" }],
    allowed_networks: ["eip155:8453"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  },
});

const res = await guarded("https://api.example.com/paid");
res.headers.get("x-paystage-verdict"); // "pay" | "review" | "do_not_pay"
```

## What it decides

| Situation | Result |
|---|---|
| Not a 402 | respond normally, verdict `pay`, reason `no_payment_required` |
| Policy allows | delegate to `x402-fetch`, sign and pay, verdict `pay` |
| Policy denies | return the **original 402** with verdict `do_not_pay` — nothing is signed |
| Challenge unreadable | verdict `review` — refuse rather than guess |
| Policy itself invalid | throws at construction, not at payment time |

A refusal returns the server's real challenge, not a manufactured error, so the caller can
log what was actually asked for.

## Why not just `maxValue`

`maxValue` in `x402-fetch` is one number. A spend policy is not one number: it is who may
be paid, in which asset, on which network, for how long, and what to do when the payee is
unknown. The interesting failures are the ones a single ceiling cannot express —
the right amount sent to the wrong address is still a drained wallet.

## Honest limits

- It evaluates **before** signing, using the 402 challenge. It cannot see what the server
  does after settlement.
- The receipt is a verdict header (`x-paystage-verdict`, `x-paystage-reason-codes`). It is
  not yet a signed, independently verifiable receipt — that is what
  [`@paystage/mcp`](https://www.npmjs.com/package/@paystage/mcp) `paystage-verify` and the
  hosted API produce.
- No evaluation has been run against a live adversary. See `docs/why-preflight.md` in the
  repository.

## Related

- [`@paystage/preflight`](https://www.npmjs.com/package/@paystage/preflight) — the evaluator
- [`@paystage/policy`](https://www.npmjs.com/package/@paystage/policy) — the policy schema
- [`@paystage/mcp`](https://www.npmjs.com/package/@paystage/mcp) — the same gate as an MCP server

## The seller's side: refuse before verification

`guardFetch` protects an agent that pays. `paystageVerifierHook` protects a seller that is about to be
paid — it plugs into the hooks `@x402/core` runs before verification, so a payment that violates your
policy is aborted before the facilitator is asked to verify or settle it.

```ts
import { x402ResourceServer } from "@x402/core/server";
import { paystageVerifierHook } from "@paystage/x402-guard";

const server = new x402ResourceServer(facilitator)
  .registerExtension(paystageVerifierHook({ policy }));
```

It cannot be bypassed by a caller who forgot to use our client, which is the failure mode a
client-side guard always has.

**It fails closed.** If policy evaluation throws, the payment is aborted with
`paystage_evaluation_failed`. A hook that failed open would look like protection and behave like
consent — there is a test for exactly that.

## On the SDK directly: one hook

## Two packages, similar names

`x402-fetch` (unscoped, 1.x) takes a **signer** and is what `guardFetch` wraps. `@x402/fetch` (scoped, 2.x) takes an
**`x402Client`** and is the line this project itself uses elsewhere. They are not interchangeable: passing a v2 client
to `walletClient` raises a named error rather than failing inside the peer with `createPaymentPayload is not a
function`. On v2, register the hook below instead — the policy, verdicts and reason codes are identical.

`guardFetch` covers anyone paying through `x402-fetch`. If you drive `@x402/core` yourself, core exposes
`onBeforePaymentCreation` — which runs before a payment payload exists and can abort with a reason:

```ts
import { x402Client } from "@x402/core/client";
import { paystageClientHook } from "@paystage/x402-guard";

const client = x402Client.fromConfig({ schemes: [/* … */] });
client.onBeforePaymentCreation(paystageClientHook({ policy }));
```

Same policy, same verdicts, same reason codes as every other surface. A refusal aborts payload creation, so
nothing is signed and the reason travels with it.

## The signer boundary: `@paystage/x402-guard/signer`

The hooks above decide whether a payment **should** be built. They cannot stop an agent that skips
the call and signs. This subpath wraps the account's `signTypedData` — the last step every EIP-3009
x402 payment passes through — and produces no signature unless a **verified PayStage receipt** covers
the exact payment terms being signed.

```ts
import { createSignerGuard } from "@paystage/x402-guard/signer";

const signer = createSignerGuard(account, {
  gate: async ({ payment, digest }) => {
    // Your gate: return the signed PayStage receipt bound to `digest`.
    return { receipt: await fetchVerdict(payment, digest) };
  },
});
// Pass `signer` to @x402/evm, never the raw account.
```

The gate returns a signed receipt whose **`payment_digest`** (inside the signed payload) equals the
`digest` it was given; `request_sha256` keeps its usual meaning. The adapter verifies the receipt's
ES256 signature, that digest, its `payment` block and its expiry before it calls the account.

It refuses for three reasons, as a thrown `SignerRefusedError` with a stable `code`:

| `code` | When | What the message carries |
|---|---|---|
| `do_not_pay` | the verified receipt says `do_not_pay` | the gate's rule (`rule`), not just "refused" |
| `gate_unreachable` | timeout, 5xx, malformed body | why; and that an unreachable gate is not an approval |
| `digest_mismatch` | the receipt's signed `payment_digest` differs from the digest of the terms about to be signed | both digests |

The digest is the **payment-terms digest**, not `hashTypedData(...)`: over EIP-3009, the typed data's
`nonce`, `from`, `validAfter` and `validBefore` do not exist in a 402 challenge, so a gate cannot know
them before the client signs. Both the receipt builder and this adapter call
`paymentTermsDigest` from `@paystage/preflight`, which hashes `{scheme, network, asset, amount,
payee}` with a domain separator. A verdict issued for a 0.05 USDC authorization therefore cannot be
replayed against a 5.00 one — the amount changes the digest and the adapter refuses before calling
the signer. A `review` verdict is refused by default (`onReview: "pay"` opts into a pre-arranged
step-up).

`paymentDigest()` (the exact EIP-712 digest) is still exported as a diagnostic, but it is not the
value the receipt carries. The terms digest binds price, payee, asset, network and scheme; it does
**not** bind the nonce, payer or validity window, and it does not prove a payment settled.

**Fail-closed is deliberate here, and it is the opposite of the telemetry rule.** A missing telemetry
*label* is not a missing *verdict*, so a failed POST is swallowed. Here the gate supplies the verdict
itself; with no receipt there is no approval, and "unknown" must never be read as "pay".

**What it does not prove.** It binds **one account object** through **this wrapper**. An agent that
holds the same key and calls the unwrapped `signTypedData` is unaffected — that is the adoption
number the backlog row is about, not something a library can enforce for a signer it was not given.
`viem` is an optional peer for this subpath only; the base guard does not import it.

## Any facilitator, unchanged

The verifier hook attaches to the **resource server**, not to the facilitator — so it composes with
whatever facilitator you already run: CDP, PayAI (`@payai/facilitator`), a self-hosted one, or none.
Those packages are configuration (a URL and auth headers); there is nothing in them to wrap, which is
why this is a hook rather than a per-facilitator package.

```ts
const server = new x402ResourceServer(createFacilitatorConfig(PAYAI_URL))
  .registerExtension(paystageVerifierHook({ policy }));
```

A refused payment aborts in `beforeVerify`, so the facilitator is never asked to verify or settle it.
That ordering is the point, and there is a test asserting the facilitator's methods are never called.

## Keep the verdict

A refusal that leaves no trace is a refusal nobody can debug. Two opt-in seams:

```ts
guardFetch(fetch, {
  policy,
  onVerdict: (v) => log.info(v),                       // your logger
  telemetryUrl: "https://api.paystage.xyz/v1/guard-verdict", // or the hosted collector
})
```

The record is `{ verdict, reasonCodes, payTo, at }` — **no wallet address, no signature, no request
body.** Telemetry is fire-and-forget and never on the payment path: a failed POST cannot fail the call,
and a throwing logger cannot change whether a payment is allowed.

## Circle's batched client

`@circle-fin/x402-batching` exposes the same `onBeforePaymentCreation` hook `@x402/core` does, so this is a registration and
not an adapter — its context (`{ paymentRequired, selectedRequirements }` with `{ scheme, network, asset, amount, payTo,
maxTimeoutSeconds }`) is the shape this package already reads:

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { paystageClientHook } from "@paystage/x402-guard";

const client = new GatewayClient({ /* … */ });
client.onBeforePaymentCreation(paystageClientHook({ policy }));
```

The hook runs before the payment payload exists, so a refusal aborts the batch before anything is signed. Verified against
`@circle-fin/x402-batching@4.0.0` type definitions in `tests/circle-batching.test.ts` — if their context shape changes, that
test fails here instead of in someone's signing loop.

## `onReview` — the default that contradicts our own skill, documented rather than changed

`review` means the policy found something worth a human's attention (an unknown payee, an unusual amount) but did not refuse.
**`options.onReview` defaults to `"pay"` (`src/index.ts:168`): a `review` verdict is let through with the reason attached.**

That contradicts the instruction we give agents in `packages/skill/SKILL.md` — *"`review` means stop and ask"* — and it is the wrong default on the merits: a
caller who omits an option has not chosen a policy, so paying on `review` is the guard inventing authority for them. It is documented here, and pinned by
`tests/onreview-default.test.ts`, because **changing it is a semver-visible break** and a default that flips under a patch release is worse than a wrong
default written down.

**Slated for the next major:** default to `"refuse"`, update `SKILL.md` and this section in the same commit, and put the reason in the changelog — *a caller that
omits the option has not chosen to pay.*
