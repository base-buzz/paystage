# PR draft — punkpeye/awesome-mcp-servers

## Suggested README entry

Place under the payments/finance section (or developer tools if no payments section exists), matching the existing list style:

```
- [PayStage Preflight](https://github.com/base-buzz/paystage) 📇 🏠 🍎 🪟 🐧 - x402 payment preflight. Checks a proposed payment against a local policy and returns pay, review, or do_not_pay before the agent signs.
```

Adjust the emoji/OS markers to match the repo's current legend. If the repo does not use OS markers, drop them and keep the description.

## PR description body

### Add PayStage Preflight

Adds `@paystage/preflight`, a stdio MCP server for x402 payment preflight.

**What it does:** Before an agent signs an x402 payment, it asks PayStage Preflight whether the payment should happen. The server evaluates the proposed payment (amount, asset, network, payee) against a local JSON policy file and returns one of three verdicts:

- `pay` — within policy; proceed.
- `review` — outside auto-approve bounds; escalate.
- `do_not_pay` — violates policy; do not sign.

**Why it's useful:** Agents that can pay will pay the wrong amount to the wrong address if nothing gates them. A preflight check is the smallest useful safety primitive: it runs before money moves and returns a decision the agent can act on.

**Transport:** stdio.

**Install:**

```
npx @paystage/preflight
```

**Policy:** plain JSON, snake_case keys. Supports max single payment, payee allowlist, allowed networks (CAIP-2, e.g. `eip155:8453` Base mainnet, `eip155:84532` Base Sepolia), and a configurable verdict for unknown payees. Policy path is set via `PAYSTAGE_POLICY_PATH`.

**Links:**

- npm: https://www.npmjs.com/package/@paystage/preflight
- GitHub: https://github.com/base-buzz/paystage
- Website: https://paystage.xyz

**Scope:** early stage, tool #1 from PayStage. No custody, no signing, no hosted service. Returns a verdict only.
