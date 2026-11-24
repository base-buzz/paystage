# @paystage/preflight

Evaluate an [x402](https://x402.org) `PaymentRequired` against a local spending
policy **before** your agent pays. Returns one of three verdicts: `pay`,
`review`, or `do_not_pay`.

- **Local-first** — policy lives in a JSON file on your machine. No secrets, no
  network calls to decide.
- **MCP-native** — runs as a stdio MCP server so Claude Desktop, Cursor, and any
  MCP client can call it as a tool.
- **Deterministic** — same input + same policy ⇒ same verdict.

## Dependencies

The evaluator has no runtime dependency other than `@paystage/policy`, and that package has none
of its own (#181): `npm i @paystage/preflight` installs this package and the policy parser, and
no schema library. The optional MCP server entry (`@paystage/preflight/mcp`) needs
`@modelcontextprotocol/server`, which lists zod as its own dependency — that is the official
SDK's dependency, not this package's.

## Try it offline (no keys, no spend)

```bash
npx -y @paystage/preflight demo
```

A bundled policy and bundled challenges, evaluated by the same `evaluatePayment`
function. It prints each verdict and the rule that fired, then a five-line
snippet for running it against your own policy. No network, no environment, no
key, no signing.

For the MCP server, use the `paystage-preflight-mcp` bin in your client config
below; it needs the optional `@modelcontextprotocol/server` peer.

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paystage-preflight": {
      "command": "npx",
      "args": ["-y", "-p", "@paystage/preflight", "-p", "@modelcontextprotocol/server", "paystage-preflight-mcp"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json"
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "paystage-preflight": {
      "command": "npx",
      "args": ["-y", "-p", "@paystage/preflight", "-p", "@modelcontextprotocol/server", "paystage-preflight-mcp"],
      "env": {
        "PAYSTAGE_POLICY_PATH": "/absolute/path/to/policy.json"
      }
    }
  }
}
```

## Example `policy.json`

```json
{
  "version": 1,
  "name": "standard",
  "allowed_networks": ["eip155:8453", "eip155:84532"],
  "allowed_assets": [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  ],
  "allowed_pay_to": ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  "max_amount_per_call": "1.00",
  "max_amount_per_session": "10.00",
  "require_human_above": "0.50",
  "max_timeout_seconds": 300,
  "default_verdict": "review"
}
```

Amounts are human-readable USDC (e.g. `"0.50"` = 0.50 USDC). Networks use
CAIP-2 identifiers.

## Verdicts

| Verdict       | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `pay`         | Within policy — safe to proceed automatically.                          |
| `review`      | Needs stronger attestation before paying: a `step_up` threshold, an unknown payee under `review`, or `require_human_above`. The reason names the rule; a step-up lists the principal's non-browser answers, with a person as the fallback. |
| `do_not_pay`  | Violates policy (network, asset, payTo, amount, timeout, or malformed). |

## Step-up (`step_up`)

Risk-based friction: a payment that is small and to a payee the payer has paid before goes through; a large or
novel one returns `review` with the threshold in the reason.

```json
"step_up": {
  "amount_above": { "value": "0.02", "asset": "USDC", "decimals": 6 },
  "unknown_payee": true,
  "first_payment_from_payer": false,
  "answers": ["pre_signed_allowance", "second_key", "bounded_auto_approve"]
}
```

Reasons begin with the trigger id: `step_up.amount: ...`, `step_up.unknown_payee: ...`,
`step_up.first_payment: ...`. The result's `stepUp` object (and the review packet's `step_up`) carries the
trigger, the threshold, the non-interactive `answers` and `fallback: "human"`. Pass
`paymentHistory: { payees, paymentCount }` to `evaluatePayment`; the evaluator is stateless, and absent history is
treated as no evidence, so novelty thresholds fire rather than silently passing. `step_up` does not add a fourth
verdict: it is a reason for `review`.

## Solana

A `solana:*` accept is evaluated when the policy lists that network (or `solana:*`) and a
Solana mint and payee. The four checks are the ones `@x402/svm` makes on a payment
requirement before it builds a payload: the network is one of its three CAIP-2 ids, the
`asset` mint and `payTo` are 32-byte base58 addresses, and `amount` is an integer inside
the SPL Token `u64` range.

`@x402/svm` is an **optional peer**, not a dependency. Without it the same four checks run
against the built-in copies and the evaluation transcript records that the peer was not
loaded. A host that wants the package's own tables can call `loadSvmPeer()` once at start-up.
The EVM known-drainer, non-receivable and OFAC lists hold EVM addresses, so the transcript
marks them skipped for a Solana payee rather than claiming a match.

## Supply chain and access

Socket.dev scores this package on what it *can* do, not what it does with it, so the
flags it raises are worth explaining rather than removing:

| Flag | Why it is there |
| --- | --- |
| Filesystem access | Reads the policy JSON you point it at (`policy_path` / `PAYSTAGE_POLICY_PATH`). Nothing is written. |
| Environment variable access | `PAYSTAGE_POLICY_PATH` only (and `PAYSTAGE_RPC_URL` via `auth-watch`). |
| Network access, URL strings | None in this package. The RPC endpoints you may see in the tree belong to `@paystage/auth-watch`. |

No shell, no `eval`, no telemetry, no key custody. The full table is in
[SECURITY.md](../../SECURITY.md); the deny list is published with a citation per
entry in [KNOWN_DRAINERS.md](./KNOWN_DRAINERS.md).

## Links

- Website: <https://paystage.xyz>
- X: <https://x.com/paystage_xyz>
- Source: <https://github.com/base-buzz/paystage>
- License: MIT

## Sanctions screening

The payee is checked against two lists, and the reason code says which one fired:

- **`known drainer`** — a curated list of addresses that take funds without delivering, every entry cited
- **`sanctioned address (OFAC SDN)`** — EVM addresses from the US Treasury's SDN list, generated by
  `node /work/ops/bin/ofac-sync.mjs` from the Treasury's own publication. Both are hard denials, and an
  allow-list entry does not override either: a policy that lists a sanctioned address still refuses it.

The reason matters. A drainer takes your money; paying a sanctioned address may make *you* the violation.
Different problems, different citations, one refusal.
