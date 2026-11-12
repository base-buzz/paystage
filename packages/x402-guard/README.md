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
