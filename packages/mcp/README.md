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

## Packages

| Package | Version | Purpose |
| --- | --- | --- |
| `@paystage/mcp` | Umbrella server (5 tools) |
| `@paystage/preflight` | x402 payment preflight |
| `@paystage/auth-watch` | Outstanding-auth tools |
| `@paystage/trade-preflight` | HIP-3 / trade.xyz trade preflight |
| `@paystage/velocity` | Rate / spend-pattern checks |
| `@paystage/policy` | Shared policy schema + loader |

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
