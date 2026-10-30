# @paystage/policy

Zod schema and BigInt amount utilities for PayStage policy documents.

## Usage

Load a policy from disk:

```ts
import { loadPolicy } from "@paystage/policy";

const policy = await loadPolicy("./policy.json");
```

Or parse an already-parsed JSON value:

```ts
import { parsePolicy } from "@paystage/policy";

const policy = parsePolicy({
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "review"
});
```

Amount utilities never use JavaScript `Number` for money math:

```ts
import { atomicToHuman, humanToAtomic } from "@paystage/policy";

humanToAtomic("1.00", 6); // 1000000n
atomicToHuman(10000n, 6); // "0.01"
```
