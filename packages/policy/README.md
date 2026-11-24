# @paystage/policy

Shared spending-policy schema and loader for PayStage agent payment tools.

## Install

```bash
npm install @paystage/policy
```

## Zero runtime dependencies

This package has **no runtime dependencies** (#181). The policy parser is hand-written
(`src/guards.ts`); zod is a **devDependency**, used by `tests/differential.test.ts` as the oracle
for every fixture in the repository plus generated mutations. That test is the reason the
replacement is safe: it asserts the same accept/reject decision, the same parsed output and the
same `invalid policy:` message, byte for byte.

The gain is narrow and worth stating exactly. This is the evaluator every other surface depends
on, so `npm i @paystage/preflight` is now one installable evaluator with no schema library in the
tree.

What this does **not** claim: `@paystage/mcp`, `@paystage/velocity`, `@paystage/auth-watch`,
`@paystage/trade-preflight` and `@paystage/ai-sdk` are built on the official
`@modelcontextprotocol/server` SDK, which lists zod as its own dependency. They inherit zod from
the SDK; removing our imports does not remove it from a user's tree.

## Usage

```ts
import { parsePolicy, loadPolicy, humanToAtomic } from "@paystage/policy";

// Parse an in-memory object (validates against the schema).
const policy = parsePolicy({
  version: 1,
  // The ceiling is per asset, and every allowed asset must be capped unless allow_uncapped_assets says otherwise.
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_networks: ["eip155:8453"],
  // `network` is optional: an entry without one matches this address on any network the policy allows (#37).
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  ],
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  max_timeout_seconds: 300,
  unknown_payee: "review",
  // Optional step-up (#414): a large or novel payment becomes `review`, answerable by the principal without a
  // browser. `answers` defaults to all three non-interactive methods; human approval is only the fallback.
  step_up: {
    amount_above: { value: "0.02", asset: "USDC", decimals: 6 },
    unknown_payee: true,
    answers: ["pre_signed_allowance", "second_key", "bounded_auto_approve"],
  },
});

// Load and validate from disk.
const fromDisk = await loadPolicy("./policy.json");

// Convert human-readable USDC to atomic units (6 decimals).
humanToAtomic("0.50"); // "500000"
```

## API

- `parsePolicy(input)` — validate an object, returns a typed `Policy`.
- `loadPolicy(path)` — read + parse a JSON policy file.
- `humanToAtomic(amount)` — convert `"0.50"` → `"500000"` (USDC, 6 decimals).

## Supply chain and access

| Flag | Why it is there |
| --- | --- |
| Filesystem access | `loadPolicy()` reads one JSON file — the policy it evaluates against. It never writes. |
| Environment variable access | `PAYSTAGE_POLICY_PATH`, as a fallback when no path argument is given. |
| Network access | None. This package is pure: policy in, normalised policy out. |

No shell, no `eval`, no telemetry. Full table: [SECURITY.md](../../SECURITY.md).

## Links

- Website: <https://paystage.xyz>
- X: <https://x.com/paystage_xyz>
- Source: <https://github.com/base-buzz/paystage>
- License: MIT
