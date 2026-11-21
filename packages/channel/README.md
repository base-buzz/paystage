# `@paystage/channel`

Read-only inspection of an **x402 batch-settlement deposit channel** on Base.
Two `eth_call` view calls, no keys, no signing, no transaction.

```ts
import { readChannel } from "@paystage/channel";

const channel = await readChannel({
  channelId: "0x…",              // bytes32, from the deposit tx / 402 extra
  chain: "eip155:8453",          // Base mainnet, or eip155:84532 for Sepolia
  withdrawDelay: 86400,          // ChannelConfig.withdrawDelay, optional
  signedMaxClaimable: "25000000" // from the voucher you hold, optional
});
```

Returns:

| field | source | notes |
|---|---|---|
| `balance` | `channels(bytes32)` | deposited, unclaimed balance in token base units |
| `signedMaxClaimable` | **signed voucher, off chain** | cumulative ceiling, not remaining balance; `null` unless you pass it, because there is no contract storage for it |
| `withdrawRequestedAt` | `pendingWithdrawals(bytes32)` → `initiatedAt` | unix seconds, `0` when no withdrawal is pending |
| `expiry` | derived | `withdrawRequestedAt + withdrawDelay`; `null` when no request or delay unknown |

`raw.channels` and `raw.pendingWithdrawals` carry the exact hex responses, and
`unavailable` says which field(s) could not be resolved and why.

## What this reads

- Contract: `0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003` — the x402
  batch-settlement contract (from `BATCH_SETTLEMENT_ADDRESS` in `@x402/evm`).
  Verified present with `eth_getCode` on Base mainnet (`0x2105`) and Base
  Sepolia (`0x14a34`) on 2026-11-20.
- Network: Base mainnet / Base Sepolia. One contract holds many channels, keyed
  by `bytes32 channelId`; there is no per-channel contract address.
- ABI: `channels(bytes32) returns (uint128 balance, uint128 totalClaimed)` and
  `pendingWithdrawals(bytes32) returns (uint128 amount, uint40 initiatedAt)`.

The `channelId` is `computeChannelId(ChannelConfig)` from `@x402/evm`
(EIP-712 hash of payer, payerAuthorizer, receiver, receiverAuthorizer, token,
withdrawDelay, salt). It can also be read from the contract with
`getChannelId(config)`.

## What it deliberately does not do

It has no wallet client, no `writeContract`, no `sendTransaction`, no private-key
input, and no runtime dependency. The test suite scans `src/` for those
identifiers and asserts `dependencies` is empty. Only `eth_call` is sent.

## Live read

```bash
npm run build -w @paystage/channel
node packages/channel/scripts/read-live.mjs \
  0x1dc6371a716991c8eb1cd8fdff2c21ad56a3c2ca835c0a83b480c7cf7f88da93
```

Recorded 2026-11-20 on Base mainnet at block 59,972,547 for that real channel:
`balance 20001600`, `totalClaimed 19958880`, `withdrawRequestedAt 0`,
`expiry null`. `signedMaxClaimable` is `unassessed`: it is not on chain, and no
signed voucher for that channel was available to this read.

## Publishing is blocked

`package.json` sets `"private": true` so `scripts/check-manifest-packages.mjs`
skips it and no release attempts to publish the name.

When an npm Trusted Publisher exists for `@paystage/channel`, do **all** of:

1. set `"private": false` in `packages/channel/package.json`;
2. add `"@paystage/channel"` to `PACKAGE_VERSIONS` in
   `apps/console/src/lib/agent-manifest.ts`;
3. add the name to `PKGS` in `.github/workflows/release.yml` (the lists near
   lines 85 and 165);
4. add it to `cadence.yml` around line 105;
5. add it to the root `build`/`test` lists if it is not already there.

Nothing in this package pushes, publishes or tags.
