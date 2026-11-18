# @paystage/mcp

PayStage umbrella MCP server: payment preflight, auth watch, HIP-3 trade preflight, and velocity checks.

> Not financial advice. The trade preflight tool is a local policy gate only — it does not
> place orders or recommend trades.

Published on npm as **`@paystage/mcp`** — see the [npm page](https://www.npmjs.com/package/@paystage/mcp) for the current version rather than a number here that can go stale.


## What a valid receipt means

`paystage-verify` returning exit 0 means **the key it verified against signed this receipt
and it has not been altered**. That is all it means — and which key that was matters:

- `key_source: "published"` → PayStage's published key: the issuer signed it.
- `key_source: "supplied"` (you passed `--key` or `--key-url`) → **the key you named signed
  it**, which is a weaker claim and not evidence about PayStage at all. Exit 0 on that path
  says nothing more than that the holder of that key produced the receipt.

It does **not** mean the payment happened — settlement is a separate on-chain event. It does
not mean the verdict was correct — a receipt records a decision, not the soundness of the
policy behind it. And it does not identify the caller; no caller identity is bound into the
payload, by design.

Two narrower points a careful reader should know:

- **`key_source` tells you where the verifying key came from**: `published` (PayStage's
  endpoint) or `supplied` (someone passed `--key`). A receipt verified against a supplied key
  proves only that the holder of *that* key signed it.
- **A receipt with `signed: false` is still useful**: the request and policy digests are
  checkable, so "over these inputs" survives even when provenance does not.
- **`--max-age` is your policy, not the issuer's.** Nothing in the signed payload says how
  long a verdict is meant to hold, so a freshness bound is set by the verifier. If "this
  verdict is good for 24 hours" ever becomes the issuer's promise it has to be signed, and
  that is a format change.


## Install

```sh
npx -y -p @paystage/mcp paystage-mcp
```

The server waits silently for an agent app to connect. That's normal; press Ctrl+C to exit. To try the tools without an app, run `npx @modelcontextprotocol/inspector npx -y -p @paystage/mcp paystage-mcp`.

Or:

```sh
npm install @paystage/mcp
```

The package exposes a `stdio` MCP server (bin: `paystage-mcp`).

## MCP configuration

```json
{
  "mcpServers": {
    "paystage": {
      "command": "npx",
      "args": ["-y", "-p", "@paystage/mcp", "paystage-mcp"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "./policy.json"
      }
    }
  }
}
```

Environment variables (all optional):

- `PAYSTAGE_POLICY_PATH` — path to `policy.json` spending rules
- `PAYSTAGE_RPC_URL` — Base RPC URL override

## Tools

### `evaluate_mcp_payment` — Available now

Evaluates a proposed x402 payment against a local policy file and returns a verdict before
the agent signs anything.

### `list_outstanding_auths` — Available now

Lists outstanding ERC-20, Permit2, and EIP-3009 authorizations.

### `evaluate_outstanding_auths` — Available now

Flags outstanding authorizations that need attention (e.g. authorized but never settled).

### `evaluate_hip3_trade` — Available now

Evaluates a proposed HIP-3 / trade.xyz order against a local `TradePolicy` and returns a
decision: `allow` | `review` | `do_not_trade`.

Backed by [`@paystage/trade-preflight`](https://www.npmjs.com/package/@paystage/trade-preflight)
(published separately), which can also be run standalone:

```sh
npx -y @paystage/trade-preflight
```

The policy is passed as a tool argument; no extra environment variables are required for
this tool.

### `evaluate_velocity` — Available now

Is this spend a burst, a spike, or a runaway cadence? Takes the recent action history and a
`policy.velocity` block, and returns `pay` | `review` | `do_not_pay` with the window that was breached.

### `verify_receipt` — Available now

Checks a receipt against the published signing key and returns the verdict it attests to, or why it
cannot be trusted. `VALID`, `INVALID` (altered), `EXPIRED` (past its own lifetime), `payment-mismatch`
(genuine, but about a different payment), or `UNVERIFIABLE` — which is a refusal, not a pass.

### `decode_payment_required` — Available now

Decodes a base64 `payment-required` header from a 402 response into the JSON challenge: scheme,
network, asset, atomic amount, payee, resource and timeout. Pure decoding — no network call, no
verdict. Use `evaluate_mcp_payment` when you want a decision.

### `validate_policy` — Available now

Checks a policy document without evaluating a payment, and returns the exact field and message when
it is wrong. Worth running in CI on the policy an agent ships with: an invalid policy makes every
evaluation refuse, which looks like a product bug and is not one.

### `evaluate_batch` — Available now

The same question for several payments at once, one verdict each in input order — so an agent settling
a batch stops at the first refusal instead of discovering it after three payments.



## Packages

Ten packages. Only `@paystage/mcp` exposes **ten MCP tools**; the rest are the evaluator, guards for other
frameworks, a policy schema and a skill — hence ten packages and ten tools in the same breath.

<!-- packages:table:start -->
| Package | Role | Links |
| --- | --- | --- |
| `@paystage/mcp` | umbrella MCP server — start here | [npm](https://www.npmjs.com/package/@paystage/mcp) |
| `@paystage/x402-guard` | policy gate for x402 clients, before the wallet signs | [npm](https://www.npmjs.com/package/@paystage/x402-guard) |
| `@paystage/ai-sdk` | the same gate as Vercel AI SDK tools | [npm](https://www.npmjs.com/package/@paystage/ai-sdk) |
| `@paystage/auth-watch` | outstanding ERC-20 / Permit2 / EIP-3009 authorisations | [npm](https://www.npmjs.com/package/@paystage/auth-watch) |
| `@paystage/policy` | policy schema and loader | [npm](https://www.npmjs.com/package/@paystage/policy) |
| `@paystage/preflight` | x402 payment preflight (the evaluator) | [npm](https://www.npmjs.com/package/@paystage/preflight) |
| `@paystage/skill` | agent skill manifest | [npm](https://www.npmjs.com/package/@paystage/skill) |
| `@paystage/trade-preflight` | HIP-3 / trade.xyz order preflight | [npm](https://www.npmjs.com/package/@paystage/trade-preflight) |
| `@paystage/velocity` | rate and spend-pattern checks | [npm](https://www.npmjs.com/package/@paystage/velocity) |
| `@paystage/x-evm` | chain-agnostic EVM helpers | [npm](https://www.npmjs.com/package/@paystage/x-evm) |
<!-- packages:table:end -->

## Verify a receipt

Every verdict can carry a signed receipt. `paystage-verify` checks one without trusting
us — it fetches the published key and verifies the signature over the canonical payload.

```sh
npx -y -p @paystage/mcp paystage-verify receipt.json
cat receipt.json | npx -y -p @paystage/mcp paystage-verify -
```

Exit codes are distinct on purpose:

| Code | Meaning |
|---|---|
| 0 | signature matches the payload |
| 1 | **invalid** — altered, or signed by a different key |
| 2 | unsigned — a record of the decision, with no proof of who made it |
| 3 | unverifiable — the key could not be fetched, or an input file could not be read, so nothing can be checked |
| 4 | inputs-mismatch — the receipt is genuine but does not cover the `--request`/`--policy` you supplied |
| 5 | stale — the receipt is genuine but older than `--max-age` allows |

"Invalid" and "could not check" are different facts and must not collapse into one
failure. `--key <file>` verifies against a local JWK for point-in-time checks.

## Supply chain and access

This is the umbrella, so its install tree is wider than any single tool and Socket
flags it accordingly. What it actually contains:

| Flag | Where it comes from |
| --- | --- |
| Network access, URL strings | `@paystage/auth-watch` (Base RPC reads) and `@paystage/trade-preflight` (one Hyperliquid info query). |
| Filesystem access | `@paystage/policy` reading your policy file. |
| Environment variable access | `PAYSTAGE_POLICY_PATH`, `PAYSTAGE_RPC_URL`. |
| "AI-detected code anomaly" | The official `@modelcontextprotocol/server` SDK's bundled JSON-schema validator, not PayStage code. |

The umbrella itself is ~16 KB with no network, no filesystem and no `eval` — the
capability lives in the dependencies, because that is what the tools are for.

Install a narrower surface if you only need part of it: `@paystage/preflight` and
`@paystage/policy` make no network calls at all.

Full table: [SECURITY.md](../../SECURITY.md).

## Links

- Verify receipts: `npx -y -p @paystage/mcp paystage-verify <receipt.json>`

- Website: [paystage.xyz](https://paystage.xyz)
- HIP-3 context: [docs.trade.xyz](https://docs.trade.xyz)
- Source: [github.com/base-buzz/paystage](https://github.com/base-buzz/paystage)
- X: [x.com/paystage_xyz](https://x.com/paystage_xyz)

## License

MIT

## Tools

Every one is read-only. None of them signs, holds a key, or moves money — the agent stays the only
signer, which is the entire product.

<!-- tools:table:start -->
| tool | what it answers |
|---|---|
| `evaluate_mcp_payment` | should this x402 payment be signed? → `pay` · `review` · `do_not_pay` |
| `list_outstanding_auths` | which ERC-20 / Permit2 / EIP-3009 authorisations are still outstanding |
| `evaluate_outstanding_auths` | which of those need attention before the next payment |
| `evaluate_hip3_trade` | should this HIP-3 / trade.xyz order be placed? → `allow` · `review` · `do_not_trade` |
| `evaluate_velocity` | is this spend a burst, a spike, or a runaway cadence |
| `verify_receipt` | is this receipt really ours — and is it about *this* payment, still in date |
| `decode_payment_required` | what does this base64 402 header actually say |
| `validate_policy` | is this policy document valid, and if not which field |
| `request_testnet_funds` | 0.5 Base Sepolia USDC for testing — one drip per address per 24h, with the reset time |
| `evaluate_batch` | the same question for several payments, one verdict each |
<!-- tools:table:end -->

## Check a policy file before you run anything

```bash
npx -y -p @paystage/mcp paystage-policy check policy.json
```

Exit `0` valid, `1` invalid (one line per offending field), `2` unreadable. Offline, no key, no signup —
the same schema the evaluator enforces, so a file that passes here is a file that will load there.

## Explain a receipt in words

```bash
npx -y -p @paystage/mcp paystage-explain receipt.json
```

```
Decision: do_not_pay
  signature valid — this receipt is what PayStage issued
  issued 2026-11-15T18:27:34Z by @paystage/hosted

  · It asks for 1 USDC, and the policy allows at most 0.05 USDC.
```

It verifies the signature first and says plainly when a receipt cannot be trusted. Rules it does not
recognise are **quoted, not paraphrased** — guessing at a refusal's meaning is worse than repeating it.
