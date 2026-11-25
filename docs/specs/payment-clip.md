# The payment clip: a real 402, a decision, and the settlement

**Status: BLOCKED before settlement.** The seller call, the 402 and the gate decision below were
observed in this run on Base Sepolia. The settlement step was **not** executed: the loadgen worker's
effective kill switch is on (`killed: true`, `stoppedReason: admin_stop`) while its deployed
`LOADGEN_KILL` variable reads `0`. The project does not spend against an operator brake, so no
transaction exists and there is **no hash in this revision**. The command that completes the clip is
in [Run it](#run-it); the fields it must fill are marked `<...>`.

This is the round trip that #113's offline decision clip could not show. It runs against the hosted
Sepolia seller (`https://sepolia.api.paystage.xyz`), so the 402 is the seller's own, not a fixture.

- Date: 2026-11-25 (UTC)
- Network: Base Sepolia `eip155:84532`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Payer: the project's loadgen wallet, address `0xC64A71E150Cd21EBC4b12695850bED6B067743Bc`
- Seller: `https://sepolia.api.paystage.xyz/v1/paid/evaluate_mcp_payment`
- Payment: a test payment this project caused, recorded as `dev-loadgen`

## Run it

One command. The key stays in the vault: `with-secret` injects it into the process and the script
prints only the derived address.

```bash
/work/ops/bin/with-secret loadgen \
  /work/ops/bin/with-secret paystage \
  node scripts/payment-roundtrip.mjs
```

`--dry-run` stops after the 402 and the gate decision; `--refuse` runs the same gate with a cap
below the price and shows that nothing is signed. The script exits `0` only when the settlement
receipt carries a hash and a public RPC reports the receipt mined with `status: 0x1`.

## 1. The seller and its 402

The unpaid request returns the seller's real challenge in the `payment-required` header. Response
body, verbatim (28 bytes):

```json
{"error":"Payment required"}
```

The decoded challenge, from the header:

```text
unpaid request: HTTP 402 Payment Required
402 challenge (payment-required header, decoded):
  resource:  https://sepolia.api.paystage.xyz/v1/paid/evaluate_mcp_payment
  network:   eip155:84532
  asset:     0x036CbD53842c5426634e7929541eC2318f3dCF7e
  amount:    2000 atomic USDC (0.002000 USDC)
  payTo:     0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE
  scheme:    exact
```

The header also carries the seller's Bazaar metadata and a `payment-identifier` extension (a
repeat id is deduplicated to `review` for ten minutes). They are not part of the payment path and are
omitted here.

## 2. The gate decides

The gate runs in the client, in `onBeforePaymentCreation`, against the exact challenge the seller
just sent — before a payment payload exists and before the wallet signs. The paid policy allows the
seller's payee and a 0.05 USDC ceiling; the verdict is `pay`:

```text
gate decision (before any signature):
  verdict:   pay
  reasons:   []
  proceed:   yes
```

The falsification is the same challenge, same seller, same payer, and a policy cap of 0.001 USDC
(below the advertised 0.002). The gate names the rule and stops at the 402:

```text
gate decision (before any signature):
  verdict:   do_not_pay
  reasons:   ["amount 0.002 USDC exceeds max_amount 0.001 USDC"]
  proceed:   no — amount 0.002 USDC exceeds max_amount 0.001 USDC
```

That is the claim the clip exists to make: the over-cap payment never reaches the signing step, and
the refusal names the rule that fired.

## 3. The settlement

**Not run.** The blocking observation, from the loadgen worker's own status endpoint:

```text
$ curl -sS https://paystage-loadgen.basebuzz69.workers.dev/
{"enabled":true,"pay":true,"killed":true,... "callsToday":35,"totalCalls":350,
 "totalSpendUsd":0.2880000000000002,"budgetUsd":50,"stoppedReason":"admin_stop",...}
```

The deployed variable itself is off. Read from the Worker's settings (the token is not printed):

```text
{ "name": "LOADGEN_KILL", "text": "0", "type": "plain_text" }
```

But the worker also honours a persisted `kill` flag in its KV state, and that flag is set
(`stoppedReason: admin_stop`). There is no `/admin/start` route in
`packages/loadgen/src/index.ts`; clearing it is an operator action, not this branch's. The operator
can clear the `kill` field in the `LOADGEN_STATE` KV key `state`, after which the same command runs.
No key was read, no signature was made, no funds moved.

When the brake is cleared, the one command above performs the settlement and prints:

- the `PAYMENT-RESPONSE` receipt decoded, including `success: true`, the payer and the transaction
  hash;
- `eth_getTransactionByHash` and `eth_getTransactionReceipt` from `https://sepolia.base.org`;
- the explorer link `https://sepolia.basescan.org/tx/<hash>`.

The settlement hash for this clip: `<not produced — blocked before signing>`.

## 4. Verifying the hash

The script already performs this check, but it is reproducible on its own once a hash exists. The
public RPC call the script makes is:

```bash
curl -sS https://sepolia.base.org \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["<hash>"]}'
curl -sS https://sepolia.base.org \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["<hash>"]}'
```

A mined settlement is a non-null `blockNumber` on the transaction and `status: "0x1"` on the
receipt. No output is pasted here because there is no hash in this revision.

## What this clip does not prove

- **It is one run, not a benchmark.** It shows the path works, not that it works under load; it says
  nothing about throughput, latency, retries, or behaviour when the facilitator is slow.
- **It is a test payment this project caused**, recorded as `dev-loadgen` (the request carries a
  signed `own-loadgen` provenance header and `x-paystage-source: test`). It is not a customer, not
  revenue, and not demand.
- **It does not settle yet.** The 402 and the gate decision are real; the on-chain half is blocked on
  the operator's kill switch. A green dry run is not a settlement.
- **It does not prove the seller will deliver.** A `pay` verdict means the payment matched the
  policy; delivery, quality and uptime are the seller's, not this clip's.
- **It is Base Sepolia only.** No mainnet funds, no real wallet, no custody. The same code paths on
  mainnet are not exercised here.

## Spend

Zero. Two unpaid 402 requests (the dry run and the refusal run) and no signed payment. The approved
caps are untouched: the run would consume 0.002 testnet USDC and one paid call, against the
$50 / 30-day and 100-call/day bounds.
