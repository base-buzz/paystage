# @paystage/x-evm

Guard for [`@x402/evm`](https://www.npmjs.com/package/@x402/evm): evaluate the payment requirements
**before** the EVM scheme signs.

```bash
npm i @paystage/x-evm
```

```ts
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { guardScheme } from "@paystage/x-evm";

const scheme = guardScheme(new ExactEvmScheme(signer), { policy });
// createPaymentPayload now throws instead of signing a payment the policy refuses
```

## Why this exists

`@x402/evm` does one thing well: it builds and signs the payload. That is exactly why a policy cannot
live there — by the time `createPaymentPayload` runs, the decision to sign has already been made.

`createPaymentPayload()` is the single choke point every scheme variant shares, so one wrapper covers
`ExactEvmScheme`, `UptoEvmScheme`, `BatchSettlementEvmScheme` and anything else inheriting it.

## A refusal throws

Not a return value. A caller that ignores a return value would sign anyway, and the point is that it
cannot. Catch `PaymentRefusedError` and read `.verdict.reasons` — the sentences name what failed, so
they can be pasted into a policy fix.

## Works across chains, not just EVM

The name says EVM but the guard wraps `createPaymentPayload`, which every x402 client scheme exposes —
`@x402/svm`'s `ExactSvmScheme`, `UptoSvmScheme` and `BatchSvmScheme` included. A Solana payment is
evaluated by the same policy; `allowed_networks` is what decides, so an `eip155:`-only policy refuses
it with a reason rather than signing it.

## Works with batching schemes too

`@circle-fin/x402-batching`'s `BatchEvmScheme` exposes `createPaymentPayload` like every other scheme,
plus batching hooks. The guard wraps only that one method, so the hooks are untouched and a guarded
batched payment is evaluated exactly like a single one. There is no separate batching package because
none is needed — there is a test that proves the hooks survive.

## What it does not do

No network calls, no keys, no signing of its own. It evaluates the requirements you were already
given and either lets the scheme proceed or refuses. Evaluation is local and synchronous in effect.

## Tests

Seven, and the ones that matter count signatures: a refused payment must leave `created === 0`.

MIT.
