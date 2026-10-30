# PayStage

Policy-gated x402 payments for MCP agents.

## Packages

- `@paystage/policy` — policy schema, loading, and BigInt amount helpers
- `@paystage/preflight` — MCP server + library that evaluates an x402 `PaymentRequired` against a policy and returns a decision

## Decisions

`@paystage/preflight` returns exactly one of three decisions:

- `pay` — safe to pay automatically
- `review` — requires human review before paying
- `do_not_pay` — must not pay

## Quick start

```bash
npm install
npm test
```

See `packages/preflight/README.md` for MCP server configuration (Claude Desktop, Cursor) and library usage.
