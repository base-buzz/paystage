# PayStage

**Your agent's wallet should not sign because a server asked it to.**

PayStage sits between an agent and the x402 payment it is about to make, and answers one
question before the signature exists: *should this payment happen?* Every tool returns
`pay`, `review`, or `do_not_pay`, with the rule that fired and a receipt you can keep.

The gap it fills is narrow and load-bearing. x402 makes paying trivial and leaves *deciding*
to the caller: a wallet enforces signatures, not intent. `@paystage/x402-guard` evaluates the
challenge before the wallet signs, so a wrong payee, an over-cap amount or an unknown asset
never reaches the signing step at all.

Try it without installing anything:

```bash
curl -s -X POST https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d '{"payment_required":{…},"policy":{…}}'
```

The hosted endpoint serves a real verdict with no payment and no account for the first 1,000 calls
per IP per day — an agent cannot fill in a signup form, so requiring one would exclude exactly
the callers this is built for.

## Quick start

```bash
# Option 1: run instantly
npx -y -p @paystage/mcp paystage-mcp

# Option 2: install locally, then use the package bin
npm install @paystage/mcp
npx paystage-mcp
```

The server waits silently for an agent app to connect. That's normal; press Ctrl+C to exit. To try the tools without an app, run `npx @modelcontextprotocol/inspector npx -y -p @paystage/mcp paystage-mcp`.

`@paystage/mcp` is the umbrella MCP server (**5 tools**, including `evaluate_hip3_trade` and `evaluate_velocity`). It exposes the PayStage tools over stdio and reads a local policy file. See [SECURITY.md](SECURITY.md) for exactly what it accesses and why.

## Four ways in

| You want | Use |
|---|---|
| the gate inside an agent's payment loop | [`@paystage/x402-guard`](packages/x402-guard) |
| the tools in Claude Desktop or Cursor | [`@paystage/mcp`](packages/mcp) |
| nothing installed at all — connect to a URL | `https://api.paystage.xyz/mcp` (Streamable HTTP, listed in the [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.base-buzz) as a remote server) |
| a verdict from your own service, hosting included | `POST https://api.paystage.xyz/v1/evaluate_mcp_payment` |
| the evaluator as a library | [`@paystage/preflight`](packages/preflight) |

## Listed on

- [mcp.so](https://mcp.so/servers/paystage-6d8a8f)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.base-buzz)
- [npm](https://www.npmjs.com/package/@paystage/mcp)
- [GitHub](https://github.com/base-buzz/paystage)

## Configure

The same MCP config works for Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`).

### Using npx

```json
{
  "mcpServers": {
    "paystage": {
      "command": "npx",
      "args": ["-y", "@paystage/mcp"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json",
        "PAYSTAGE_RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

### Using a local npm install

```json
{
  "mcpServers": {
    "paystage": {
      "command": "node",
      "args": ["./node_modules/@paystage/mcp/dist/cli.js"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json",
        "PAYSTAGE_RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

**The MCP server itself needs no environment variables and starts with an empty environment.** It
answers an MCP handshake and lists its tools with nothing configured — the policy arrives as an
argument on each call, not as a file path. Verified:

```bash
env -i npx -y -p @paystage/mcp paystage-mcp   # completes `initialize`, lists nine tools
```

The two variables below are for the **stdio CLI path**, where a policy file is convenient. They are
optional, and a directory that reads this section as "required configuration" will refuse to start a
server that in fact needs nothing:

- `PAYSTAGE_POLICY_PATH` (optional, CLI only): path to a `policy.json` the CLI reads at startup.
- `PAYSTAGE_RPC_URL` (optional): RPC endpoint used by on-chain checks. Defaults to a public Base RPC.

## Policies

Everything PayStage does is decided by one local policy file. Three complete, annotated
examples are in [`registry/examples/`](registry/examples/) — copy one, change the
addresses and amounts, and point `PAYSTAGE_POLICY_PATH` at it. Each is schema-exact for
[`@paystage/policy`](packages/policy/README.md) and annotated field by field in
[`registry/examples/README.md`](registry/examples/README.md).

- [Reader bot](registry/examples/reader-bot.policy.json) — reads articles and search results; 0.05 USDC per call, unknown payees denied.
- [Trading bot](registry/examples/trading-bot.policy.json) — places HIP-3 orders; per-agent budgets, velocity windows and human review above 10 USDC.
- [Research agent](registry/examples/research-agent.policy.json) — discovers data endpoints; unknown payees go to review, never an unattended pay.

## Tools

| Tool | Status | What it does |
| --- | --- | --- |
| `evaluate_mcp_payment` | Available now | Evaluates a proposed x402 payment against the local policy and returns `pay`, `review`, or `do_not_pay`. |
| `list_outstanding_auths` | Available now | Lists payments that are authorized but not yet settled. |
| `evaluate_outstanding_auths` | Available now | Evaluates outstanding authorizations and flags double-pay or limbo risk. |
| `evaluate_hip3_trade` | Available now | Evaluates a proposed HIP-3 / trade.xyz order against a local TradePolicy (`allow` \| `review` \| `do_not_trade`). Not financial advice — local policy gate only. |
| `evaluate_velocity` | Available now | Rate and spend-pattern velocity checks against the local policy. |

## Packages

| Package | Role | Links |
| --- | --- | --- |
| `@paystage/mcp` | Umbrella MCP server (start here) | [npm](https://www.npmjs.com/package/@paystage/mcp) |
| `@paystage/preflight` | MCP payment preflight | [npm](https://www.npmjs.com/package/@paystage/preflight) |
| `@paystage/auth-watch` | Outstanding-auth watch | [npm](https://www.npmjs.com/package/@paystage/auth-watch) |
| `@paystage/policy` | Policy parsing and evaluation | [npm](https://www.npmjs.com/package/@paystage/policy) |
| `@paystage/trade-preflight` | HIP-3 / trade.xyz trade preflight | [npm](https://www.npmjs.com/package/@paystage/trade-preflight) |

## Verify it yourself

Every claim this project makes about itself is reducible to a command. Run it before
you trust anything on the website:

```sh
node apps/hosted/scripts/conformance.mjs
```

It checks the published surfaces against reality — manifest shape, the nine tools
being listed, machine surfaces being genuinely different from each other, health and
timing headers on both networks, the receipt key endpoint, that an unpaid evaluation
is challenge-only, and that malformed input fails closed. Read-only: no payment, no
key, no account. Exit code 1 if anything is off.

It runs daily in CI ([cadence.yml](.github/workflows/cadence.yml)) and the result
history is on the [site](https://paystage.xyz).

## Supply chain

Socket.dev scores packages on capability, so a payment-safety tool will always carry
flags: it reads a policy file, reads two environment variables and talks to an RPC.
Every package README states exactly what it touches and why, and
[SECURITY.md](SECURITY.md) has the full table. The umbrella `@paystage/mcp` is ~16 KB
with no network, no filesystem and no `eval` of its own — the capability lives in the
tools it bundles.

## Links

- Website: https://paystage.xyz
- X: https://x.com/paystage_xyz
- GitHub: https://github.com/base-buzz/paystage
- npm: https://www.npmjs.com/org/paystage
- Machine-readable: https://paystage.xyz/llms.txt

## Development

This is an npm-workspaces monorepo — `package-lock.json` is the lockfile and CI runs `npm ci`.
There is no pnpm workspace and no `lint` script; `npm run typecheck` is the check that exists.

```bash
npm ci
npm run build
npm test
npm run typecheck
```

## Contributing

PayStage is built in the open, and outside contributions are welcome.

- **Add a drainer address.** Open a PR adding it to `KNOWN_DRAINERS.md` with a public source link (incident report, explorer label, or security write-up). Unsourced addresses won't be merged.
- **Add an integration example.** LangChain, AgentKit, ElizaOS and others are all welcome.
- **Report a bypass.** If an unsafe payment gets past preflight, open an issue. That's the most valuable contribution there is.

Look for issues labelled `good first issue` to get started.

## License

MIT
