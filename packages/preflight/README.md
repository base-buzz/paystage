# @paystage/preflight

MCP server and library for evaluating x402 payment required objects against a PayStage policy.

## Features

- `evaluatePayment(paymentRequired, policy)` -> `EvaluationResult`
- `normalizePaymentRequired(input)` for parsing direct, structured content, or MCP tool result shapes
- MCP stdio server exposing tool `evaluate_mcp_payment`
- BigInt-based atomic amount comparisons
- Case-insensitive asset and payee matching
- Daily cap note only (never auto-fails)

## Installation

```bash
npm install @paystage/preflight
```

## Library Usage

```ts
import { evaluatePayment, normalizePaymentRequired } from '@paystage/preflight';

const pr = normalizePaymentRequired({
  x402Version: 2,
  accepts: [{
    network: 'ethereum',
    asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amount: '100000',
    maxTimeoutSeconds: 60,
    payTo: '0x1234567890123456789012345678901234567890'
  }]
});

const result = evaluatePayment(pr, policy);
console.log(result.decision); // 'pay' | 'review' | 'reject' | 'do_not_pay'
```

## MCP Server

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paystage-preflight": {
      "command": "npx",
      "args": ["paystage-preflight"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json"
      }
    }
  }
}
```

### Cursor

Add to Cursor MCP config:

```json
{
  "mcpServers": {
    "xyz.paystage/preflight": {
      "command": "npx",
      "args": ["paystage-preflight"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json"
      }
    }
  }
}
```

## Policy Resolution

In MCP tool `evaluate_mcp_payment`, the policy is resolved in this order:

1. `policy` argument (object)
2. `policy_path` argument (string path)
3. `PAYSTAGE_POLICY_PATH` environment variable
4. `./policy.json`

## Development

```bash
npm test
npm run typecheck
npm run build
```

## License

Default-deny. No secrets.
