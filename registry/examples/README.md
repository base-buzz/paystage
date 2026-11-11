# Example policies

Three complete, pasteable spending policies for `@paystage/policy`, one per kind of
agent. Take a file, change the addresses and the amounts, point
`PAYSTAGE_POLICY_PATH` at it.

Every file here is **schema-exact**: it validates with `parsePolicy()` from
`@paystage/policy` and contains no fields the schema does not define. Annotations
live in this README, not inside the JSON, because JSON has no comments and the loader
parses the file with `JSON.parse`. Copy the JSON; read this page to understand it.

| Policy | For | Ceiling per call | Unknown payee |
| --- | --- | --- | --- |
| [`reader-bot.policy.json`](reader-bot.policy.json) | An agent that reads articles and search results | 0.05 USDC | deny |
| [`trading-bot.policy.json`](trading-bot.policy.json) | An agent that places HIP-3 / trade.xyz orders | 25.00 USDC | deny |
| [`research-agent.policy.json`](research-agent.policy.json) | An agent that discovers and pays many small data endpoints | 0.20 USDC | review |

## How the schema is read

Rule order matters. `evaluatePayment()` in `@paystage/preflight` returns `do_not_pay`
on the first rule that fails, then `review`, and only reaches `pay` when every rule
passes. The fields below are the whole schema; there are no others.

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | yes | Must be the literal `1`. |
| `max_amount` | yes | Hard per-call ceiling. An `accept` above it is `do_not_pay`. |
| `daily_cap` | no | Informational today. It is reported in `dailyCapNote` and is **not** enforced per call. |
| `allowed_pay_to` | yes | Payee allowlist, at least one `0x` address. Anything else follows `unknown_payee`. |
| `allowed_assets` | yes | At least one `{symbol, decimals, address, network}`. An asset matches only on the same network. |
| `allowed_networks` | yes | CAIP-2 ids such as `eip155:8453` (Base mainnet) and `eip155:84532` (Base Sepolia). |
| `max_timeout_seconds` | yes | Rejects an `accept` whose `maxTimeoutSeconds` is larger. |
| `require_human_above` | no | Above this amount the decision is `review`, not `pay`. |
| `unknown_payee` | yes | `deny` → `do_not_pay`; `review` → hand to a human. |
| `max_auth_validity_seconds` | no | Used by `@paystage/auth-watch` to flag long-lived allowances. |
| `allowed_spenders` | no | Extra spenders considered trusted by `auth-watch`. |
| `disallow_unlimited_approvals` | no | `auth-watch` flags an unlimited ERC-20 approval. |
| `velocity` | no | `{ windows: [...] }` rolling limits, checked by `@paystage/velocity`. |
| `agents` | no | Per-agent narrowing overlays. See below. |

`amount` in the rules above is always **atomic** (USDC has 6 decimals, so `0.05` is
`50000`). Amount specs are written human-readable in the policy:
`{ "value": "0.05", "asset": "USDC", "decimals": 6 }`.

## Per-agent overlays narrow, they never widen

When a policy has an `agents` block, `evaluatePayment()` **requires** an `agent_id`.
A call with no id, or with an id not listed, is `do_not_pay` — identity never falls
back to the global policy, because the global policy is the loosest thing in the file.
An overlay may only tighten: a smaller `max_amount`, a payee already in
`allowed_pay_to`, `review` tightened to `deny`, and so on. A block that raises a
ceiling or adds a payee is rejected when the policy is resolved, not silently applied.

## `reader-bot.policy.json`

An agent whose job is fetching search results and summaries. It can only spend on
Base mainnet, only in USDC, and only to three known reading endpoints. It cannot pay
a stranger at all.

| Field | Value | Why it is set that way |
| --- | --- | --- |
| `max_amount` | 0.05 USDC | A reading call costs fractions of a cent; 5 cents is already generous. |
| `daily_cap` | 2.00 USDC | Reported for the operator's own accounting. |
| `allowed_pay_to` | three `websearch` / `wiki` / PayStage payees | Taken from entries in [`registry/services.json`](../services.json) that were probed live. |
| `allowed_assets` | USDC on `eip155:8453` | One asset, one network: no cross-chain surprises. |
| `max_timeout_seconds` | 60 | A read should not hold an authorization for minutes. |
| `require_human_above` | 0.02 USDC | Anything over 2 cents goes to `review`. |
| `unknown_payee` | `deny` | The strictest setting; the allowlist is the only door. |
| `velocity` | 20 calls / 5 min, 1.00 USDC / day | Catches a loop that is under the per-call cap but still draining. |

## `trading-bot.policy.json`

An agent that places orders. It spends more, so it is watched more, not less: a single
payee, tight rolling windows, and a per-agent split between a cheap scout and the
agent that actually moves size.

| Field | Value | Why it is set that way |
| --- | --- | --- |
| `max_amount` | 25.00 USDC | One order's fee, with headroom. |
| `daily_cap` | 100.00 USDC | Operator's accounting ceiling. |
| `allowed_pay_to` | one Hyperliquid prediction-market payee | A trading bot should have exactly one destination. |
| `require_human_above` | 10.00 USDC | Orders above 10 USDC stop for a human. |
| `unknown_payee` | `deny` | No new counterparties at runtime. |
| `velocity` | 2 / min and 25 USDC / min, 50 USDC / hour | Stops a retry storm or a runaway loop from filling the book. |
| `agents["market-scout"]` | 0.10 USDC per call, 5.00 USDC/day, review above 0.05 | The scout only reads prices; it can never place the size. |
| `agents["position-manager"]` | 25.00 USDC per call, 100.00 USDC/day | The one identity allowed to trade at the global ceiling. |

Call `evaluate_hip3_trade` with the same file for the trade-specific rules
(`allowed_dexes`, `max_leverage`, `max_notional_usdc`), or run it with an `agent_id`
so the per-agent budget applies there too.

## `research-agent.policy.json`

An agent that discovers endpoints as it works, so its payee list is long, it speaks
both mainnet and testnet, and it is allowed to meet a stranger — but only under
`review`.

| Field | Value | Why it is set that way |
| --- | --- | --- |
| `max_amount` | 0.20 USDC | Small data calls, with room for a premium source. |
| `allowed_pay_to` | six probed endpoints | Search, wiki, prices, weather: real sellers, each already in the registry. |
| `allowed_assets` | USDC on `eip155:8453` and `eip155:84532` | The same agent is expected to run against testnet before mainnet. |
| `max_timeout_seconds` | 300 | Data calls can legitimately take longer than a read. |
| `require_human_above` | 0.10 USDC | Half the per-call ceiling goes to a human. |
| `unknown_payee` | `review` | The whole point of a research agent is that it meets new sellers. It may meet them; it may not pay them unattended. |
| `max_auth_validity_seconds` | 900 | No allowance should outlive the task. |
| `allowed_spenders` | the canonical Permit2 address | Only Permit2 may move funds for this agent. |
| `disallow_unlimited_approvals` | `true` | An unlimited approval is flagged, not signed. |
| `agents["crawler"]` | 0.02 USDC, testnet only, `unknown_payee: "deny"` | The crawler never touches mainnet and never pays a stranger. |
| `agents["analyst"]` | 0.20 USDC per call, 15.00 USDC/day | The analyst may reach the global ceiling, still under `review` for unknown payees. |

## Validate a file yourself

Every file is parseable with the published schema. From the repo root:

```sh
node -e '
  const fs = require("fs");
  const { parsePolicy } = require("./packages/policy/dist/load.js");
  for (const f of ["reader-bot", "trading-bot", "research-agent"]) {
    const p = parsePolicy(JSON.parse(fs.readFileSync(`registry/examples/${f}.policy.json`, "utf8")));
    console.log(f, "ok", p.version);
  }
'
```

Run `npm run build` first if `packages/policy/dist/` is not present. The same files are
importable in TypeScript: `parsePolicy(JSON.parse(raw))` returns a typed `Policy`.

## Links

- Package and full API: [`@paystage/policy`](../../packages/policy/README.md)
- Rule semantics: [`packages/preflight/src/evaluate.ts`](../../packages/preflight/src/evaluate.ts)
- Per-agent rules: [`packages/policy/src/agents.ts`](../../packages/policy/src/agents.ts)
- Velocity rules: [`packages/velocity/src/check.ts`](../../packages/velocity/src/check.ts)
