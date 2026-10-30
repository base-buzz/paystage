# @paystage/velocity

Rolling-window **rate and spend-pattern checks** for agent payments.

`@paystage/velocity` evaluates a proposed payment against recent history and a
policy's `velocity` configuration. It enforces per-window limits on transaction
count and aggregate amount (USDC, 6 decimals, BigInt-safe) over configurable
rolling windows such as 5, 30, and 300 minutes.

## Policy shape

Add an optional `velocity` block to a `@paystage/policy` policy:

```json
{
  "version": 1,
  "max_amount": { "value": "10.00", "decimals": 6 },
  "allowed_pay_to": ["0xabc"],
  "allowed_assets": ["USDC"],
  "allowed_networks": ["base"],
  "max_timeout_seconds": 300,
  "unknown_payee": "deny",
  "velocity": {
    "windows": [
      { "window_seconds": 300, "max_count": 5, "max_amount": { "value": "25.00", "decimals": 6 } },
      { "window_seconds": 1800, "max_count": 20 },
      { "window_seconds": 18000, "max_amount": { "value": "500.00", "decimals": 6 } }
    ]
  }
}
```

Each window may specify `max_count`, `max_amount`, or both. The `velocity`
field is optional and does not affect policies that omit it.

## API

```ts
import { checkVelocity, parseVelocityPolicy } from "@paystage/velocity";

const windows = parseVelocityPolicy(policy);

const result = checkVelocity({
  history: [
    { timestamp_ms: Date.now() - 60_000, amount_atomic: 1_000_000n },
  ],
  proposed: { timestamp_ms: Date.now(), amount_atomic: 2_000_000n },
  windows,
});

// result.decision: "allow" | "deny"
// result.reasons: string[]  // names the failing window and whether count or amount
// result.windows_checked: per-window breakdown
```

`checkVelocity` is pure: no I/O, and it uses `Date.now()` only when `now_ms`
is omitted. History actions with `timestamp_ms` strictly greater than
`now - window_seconds * 1000` are included; actions exactly at the boundary
are excluded.

## MCP tool: `evaluate_velocity`

The package exposes an MCP tool `evaluate_velocity` with input:

```json
{
  "history": [
    { "timestamp_ms": 1700000000000, "amount_atomic": "1000000" }
  ],
  "proposed": { "timestamp_ms": 1700000060000, "amount": "1.50", "decimals": 6 },
  "policy": { "...": "..." }
}
```

Amounts may be given as `amount_atomic` (decimal string of atomic units) or as
`amount` + `decimals` (human decimal string). The tool returns a JSON
`VelocityResult` with BigInt fields serialized as strings.

## Install / use

Via the PayStage umbrella MCP server:

```sh
npx @paystage/mcp
```

The umbrella registers `evaluate_velocity` alongside the other PayStage tools.

## License

MIT
