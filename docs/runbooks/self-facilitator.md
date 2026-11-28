# Runbook: PayStage's own x402 facilitator

`FACILITATOR_MODE=self` makes this deployment verify and settle its own x402 payments instead
of calling Coinbase's CDP facilitator. A facilitator is the address observed **settling** a
payment on chain, which is how a facilitator appears on `x402scan.com/facilitators`: there is
no registration form, only observed settlement. Flipping this mode is what moves PayStage from
"customer of the CDP tab" to a facilitator in its own right.

The code lives in `apps/hosted/src/self-facilitator.ts` (the in-process client) and
`apps/hosted/src/routes/facilitator.ts` (the public v2 endpoints). The package contract used
is `x402Facilitator` + `ExactEvmScheme` from `@x402/evm/exact/facilitator`; the package does
not ship an HTTP facilitator server or a local `FacilitatorClient`, so both are supplied here.

## What it does

- `GET /supported` is the x402 discovery document: exactly `SupportedResponse` from
  `@x402/core`, `{ kinds: [{ x402Version, scheme, network, extra? }], extensions, signers }`.
  The network, scheme and USDC asset come from the deployment config; `extra.verifier` is the
  same statement the 402 challenge carries. It answers **200 in every mode**, because a
  registry or monitor has to be able to tell "deployed but refusing" from "not deployed". The
  `x-paystage-facilitator` response header names the state:
  - `self` — gas signer loaded; `/verify` and `/settle` are live;
  - `self-unconfigured` — `FACILITATOR_MODE=self` but no gas key: `/supported` 200,
    `/verify` and `/settle` 503 `facilitator_not_configured`;
  - `cdp` — the default: this host is not a facilitator, `/supported` 200 describes the terms
    the deployment accepts, `/verify` and `/settle` answer 503.
- `POST /verify` accepts `{ x402Version: 2, paymentPayload, paymentRequirements }` and returns
  `{ isValid, invalidReason?, payer? }`. Rejections use a stable vocabulary:
  `invalid_signature`, `expired`, `not_yet_valid`, `insufficient`, `wrong_amount`,
  `wrong_network`, `wrong_payee`, `wrong_asset`.
- `POST /settle` accepts the same body and broadcasts
  `transferWithAuthorization` through the gas wallet. It returns the protocol's
  `{ success, transaction, network, payer, errorReason? }`.
- Both POST endpoints return HTTP 200 for a well-formed request even when the payment is
  refused; 4xx means the request was malformed. Neither reads nor emits `X-PAYMENT-*` (that is
  the v1 spelling).
- Settlement is idempotent by the `payment-identifier` extension the challenge already
  advertises: a repeat of the same id returns the first response and does not broadcast again.
  With no id, the payment signature is the dedup key. The ledger is per isolate and keeps
  successful or broadcast responses for 24 hours. A cold isolate or a second Worker instance
  does not share it, which is safe because the exact scheme also refuses a reused EIP-3009
  nonce; it only means a repeat may be re-verified rather than answered from cache.
- Only the configured payee, network, USDC asset and at least the route price are settled.
  A request for another seller is refused, so the gas wallet cannot be pointed at someone
  else's route.

## What it costs

Gas is paid by `0x680228D4915ad9f46C1cF72e1D80370b56a42405`. It holds **gas only**. Customer
USDC moves directly from payer to payee in the EIP-3009 transfer; it never touches this wallet.

Measured on the first mainnet settlement (2026-11-28):
tx `0x61f16b13f43998042fd0be6b3555e51d348c36a2454d84700698ec2e274e4711`
- block `63201891`, status `success`
- gas used **85,720**
- effective gas price **0.006 gwei**
- fee **514,320,000,000 wei = 0.00000051432 ETH ≈ $0.00086** at ETH $1,668.275

Planning numbers at the 0.005 gwei the gas sampler measured:
- at the measured 85,720 gas: `85,720 × 0.005 gwei = 0.0000004286 ETH ≈ $0.00072`
- at an optimistic 65,000 gas: `65,000 × 0.005 gwei = 0.000000325 ETH ≈ $0.00054`
- 1,000 settlements/day at the measured 85,720 gas and 0.006 gwei: `0.00051432 ETH/day`
  (≈ $0.86/day at the same ETH price); 100/day is ~$0.086/day.

Budget the gas wallet for a few hundred settlements (a few thousandths of an ETH), not a
large balance. Refill from the treasury only when the balance approaches zero.

## Checking the gas wallet before it empties

`node scripts/check-facilitator-gas.mjs` reads the balance and the current gas price from Base
and prints both plus an estimate of settlements left. It exits **10** below 0.0005 ETH
(~800 settlements at the measured 0.006 gwei), **2** when Base's RPC cannot be read, and **0**
otherwise. `ci-local` runs it as an **advisory**: it needs the network, and a red build caused
by someone else's RPC is the failure mode that trains people to pass `--no-verify`. A
below-floor result is an operator decision — refill from the treasury, or set
`FACILITATOR_MODE=cdp` until the wallet is funded. Read-only: no key, no transaction.

## Flipping the mode

Default is CDP. Nothing changes until the operator sets both of these on the Worker:

```sh
# 1. Gas key — Worker secret, read only by the runtime.
wrangler secret put FACILITATOR_GAS_PRIVATE_KEY
# 2. Select the mode (a plain var is enough; a secret works too).
wrangler secret put FACILITATOR_MODE   # value: self
```

`FACILITATOR_MODE` unset or `cdp` keeps the Coinbase client. `self` never falls back to CDP:
if the gas key is missing the paid routes fail closed and `/verify` and `/settle` answer 503
`facilitator_not_configured`. Keep the CDP credentials in place for rollback.

Rollback is the same command with `FACILITATOR_MODE=cdp`; no code change or redeploy of the
data plane is needed.

## Checking that it is settling

1. **The settlement response itself.** `POST /settle` returns the tx hash. Confirm it on
   Basescan / `eth_getTransactionReceipt`: status, gas used, and a USDC `Transfer` log whose
   `from` is the payer and `to` is `PAYSTAGE_PAYTO` for the expected amount.
2. **The events table.** A paid route that settles writes an event row with
   `decision = 'settled'`, `tx_hash`, `payer`, `amount_usdc` and `pay_to`. This is the
   settlement record; query it by `tx_hash`.
3. **`/v1/public/chain.json` is not a settlement ledger.** It reports only the current block
   height and gas price (`{ block, gasGwei, ok, observedAt }`), which is useful as a liveness
   and gas-cost check. It will never show a transaction, ours or anyone else's. Use the events
   table or an explorer for "did this payment settle".
4. **The gas wallet.** Balance should fall by the fee and the nonce should advance by one per
   settlement. Compare `eth_getBalance` / `eth_getTransactionCount` on
   `0x680228D4915ad9f46C1cF72e1D80370b56a42405` with the tx count.

A quick smoke command exists at `apps/hosted/scripts/self-settle-smoke.ts`. On testnet it uses
the faucet wallet for both roles; on mainnet it uses the gas wallet for gas and
`LOADGEN_KEY_1` as the payer. Secrets are injected by `bin/with-secret`; never export them by
hand.

```sh
# Base Sepolia rehearsal (free)
PAYSTAGE_NETWORK=eip155:84532 PAYSTAGE_PAYTO=0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE \
  /work/ops/bin/with-secret faucet \
  ./apps/hosted/node_modules/.bin/vite-node apps/hosted/scripts/self-settle-smoke.ts

# Base mainnet — one transaction, only with explicit operator authorisation
PAYSTAGE_NETWORK=eip155:8453 PAYSTAGE_PAYTO=0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE \
  /work/ops/bin/with-secret loadgen \
  /work/ops/bin/with-secret facilitator-gas \
  ./apps/hosted/node_modules/.bin/vite-node apps/hosted/scripts/self-settle-smoke.ts
```

## If the gas wallet is empty

Verification still works (it is read-only), but settlement returns `success: false` with
`settlement_failed` and no transaction. Do not retry in a loop: a failed broadcast costs
nothing, but a loop tells you nothing new.

1. Check the balance on Base: `eth_getBalance` for `0x680228D4915ad9f46C1cF72e1D80370b56a42405`.
2. Refill from the treasury in a small amount (a few thousandths of an ETH). This spends
   money and is the operator's call.
3. If funds cannot be added now, set `FACILITATOR_MODE=cdp` so the paid route keeps working.

Never take funds from a customer, and never raise a payer's amount to cover gas.

## Why a hot wallet is the risk

The gas key is a hot key: it lives in a Worker secret and signs automatically. That is
acceptable only because of what it can lose. The wallet holds **gas only** — a few cents of
ETH. It never holds customer USDC, never holds escrowed funds, never has authority over a
payer's token balance, and cannot move anything except the gas it owns. An EIP-3009 transfer
is signed by the payer and pays the payee directly; the facilitator only submits it.

If the key is compromised, the loss is the gas balance and the ability to submit payments to
our own payee. The response is to rotate the key, drain what remains, and switch back to CDP
until the new wallet is funded. Keep the balance small for exactly this reason; a large balance
turns a hot key into a treasury key, and that is not what this wallet is for.
