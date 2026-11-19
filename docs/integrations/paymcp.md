# Pairing PayStage with PayMCP

[PayMCP](https://github.com/PayMCP/paymcp) monetises **sellers** — it puts a price on an MCP tool and collects payment. PayStage gates
**buyers** — it decides whether the payment an agent is about to sign should be signed at all. Different halves of the same flow, so this
is a pairing rather than an integration to sign up for: neither package depends on the other, and either works alone.

This page documents the pairing, because a buyer-side gate is only useful where sellers actually charge.

## The halves

| half | package | what it decides |
| --- | --- | --- |
| price the tool | `paymcp` (Python) | this call costs 0.01 USDC, here is the `402` |
| gate the payment | `@paystage/preflight` | should *this* agent pay *this* challenge, under *this* policy |

PayMCP's `Mode.X402` returns a 402 challenge in x402 format; that challenge is exactly the input PayStage evaluates. There is no
translation layer, which is why the pairing is two examples rather than a plugin.

## Seller side — price a tool with PayMCP

From PayMCP's own README, abridged:

```python
from mcp.server.fastmcp import FastMCP
from paymcp import Mode, price
from paymcp.providers import X402Provider

mcp = FastMCP("priced-tool")
provider = X402Provider(pay_to=[{"address": "0xYourAddress"}])  # USDC on Base

@mcp.tool()
@price(amount=0.01, currency="USDC", provider=provider)
def token_audit(address: str) -> dict:
    ...
```

Two things worth knowing before copying that:

- PayMCP's README is explicit that **most MCP clients do not support x402 yet**, and recommends `Mode.AUTO` unless you control the client.
- `Mode.X402` is documented as incompatible with stdio deployments where users run the server locally, because it exposes payment
  provider credentials. Relevant if you were planning to ship a server *and* charge for it from the same process.

## Buyer side — gate the payment with PayStage

The challenge the seller returns is the input to the evaluator. In an agent that signs payments:

```ts
import { evaluatePayment } from "@paystage/preflight";

const verdict = evaluatePayment(decodedChallenge, policy);
if (verdict.decision !== "pay") {
  throw new Error(`refusing to sign: ${verdict.reasons[0]}`);
}
// only now does the wallet see a transaction to sign
```

`decodedChallenge` is the `402` body the seller sent; `policy` is one JSON file with a ceiling, allowed payees, assets and networks. The
evaluator is offline and read-only — it never holds a key and cannot move funds.

The same decision is available as an MCP tool (`evaluate_mcp_payment`), an x402 guard for clients (`@paystage/x402-guard`), an n8n node
and an elizaOS action, so the gate can sit wherever the signing happens.

## What this pairing does not do

- It does not make PayMCP check whether a buyer *should* pay — that is the half we provide, and the halves stay separate on purpose.
- It does not give PayStage a way to enforce a seller's price; price is the seller's claim, and the gate treats it as an input to check.
- Neither project vets the other's users. A seller using PayMCP gets no endorsement from us, and vice versa.

## Provenance for this page

Written 2026-11-19 from PayMCP's published README (`github.com/PayMCP/paymcp`, MIT, 16 stars at the time of writing) and PayStage's own
code. The PayMCP snippets are abridged from their README, not invented; if their API moves, their README is authoritative and this page is
the thing to correct.
