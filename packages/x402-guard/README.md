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
npm install @paystage/x402-guard x402-fetch
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
