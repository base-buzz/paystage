# PayStage

Local-first spending policy for AI agents that pay with [x402](https://x402.org).
Decide **before** the agent pays: `pay`, `review`, or `do_not_pay`.

- Website: <https://paystage.xyz>
- GitHub: <https://github.com/base-buzz/paystage>

## Packages

| Package | Description |
| ------- | ----------- |
| [`@paystage/policy`](./packages/policy) | Shared spending-policy schema and loader (`parsePolicy`, `loadPolicy`, `humanToAtomic`). |
| [`@paystage/preflight`](./packages/preflight) | MCP server + CLI that evaluates an x402 `PaymentRequired` against a local policy. |

## Quick start

```bash
npx -y @paystage/preflight
```

Point it at a `policy.json` via `PAYSTAGE_POLICY_PATH` and wire it into Claude
Desktop or Cursor as an MCP server. See
[`packages/preflight/README.md`](./packages/preflight/README.md) for config
snippets and an example policy.

## Development

This is a monorepo using npm workspaces.

```bash
npm install
npm run build
npm test
```

## License

MIT
