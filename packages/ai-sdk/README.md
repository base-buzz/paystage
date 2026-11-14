# @paystage/ai-sdk

PayStage preflight as [AI SDK](https://ai-sdk.dev) tools. Decide whether an x402 payment should be
signed **inside the same loop that would sign it**, with the rules that fired.

```bash
npm install @paystage/ai-sdk ai zod
```

```ts
import { generateText, gateway } from "ai";
import { paystageTools } from "@paystage/ai-sdk";

const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  unknown_payee: "deny",
};

const { text } = await generateText({
  model: gateway("openai/gpt-5-mini"),
  tools: { ...paystageTools({ policy }), ...yourPaymentTools },
  prompt: "Buy the weather data, but not above 2 cents.",
});
```

## The two tools

| tool | returns |
|---|---|
| `paystage_evaluate_payment` | `decision` (`pay` / `review` / `do_not_pay`), `reasons[]`, `summary` |
| `paystage_should_pay` | `allowed`, `decision`, `reasons[]` — one-word form for when reasoning is noise |

## What it will not do

**Nothing here signs, holds a key, or moves money.** That is not a limitation, it is the design: the
tool that decides must not be the tool that spends. Your payment tool stays where it is; these tools
only tell the model whether to call it.

Read-only also means the cost is predictable — evaluating a payment is a local computation, not a
network call and not a paid request.

## `onReview`

`review` means the policy found something worth a human's attention (an unknown payee, an unusual
amount) but did not refuse. `onReview: "refuse"` turns those into refusals; the default `"pay"` lets
them through with the reason attached.

## Related

- [`@paystage/x402-guard`](https://www.npmjs.com/package/@paystage/x402-guard) — the same policy, wrapping `fetch` so a refusal never reaches the signer
- [`@paystage/mcp`](https://www.npmjs.com/package/@paystage/mcp) — nine tools over MCP, for Claude, Cursor and anything else that speaks it
- Hosted, no install: `https://api.paystage.xyz/mcp`
