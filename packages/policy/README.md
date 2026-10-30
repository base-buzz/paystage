# @paystage/policy

Shared spending-policy schema and loader for PayStage agent payment tools.

## Install

```bash
npm install @paystage/policy
```

## Usage

```ts
import { parsePolicy, loadPolicy, humanToAtomic } from "@paystage/policy";

// Parse an in-memory object (validates against the schema).
const policy = parsePolicy({
  version: 1,
  name: "standard",
  allowed_networks: ["eip155:8453"],
  allowed_assets: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  max_amount_per_call: "1.00",
  max_amount_per_session: "10.00",
  require_human_above: "0.50",
  max_timeout_seconds: 300,
  default_verdict: "review",
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

## Links

- Website: <https://paystage.xyz>
- Source: <https://github.com/base-buzz/paystage>
- License: MIT
