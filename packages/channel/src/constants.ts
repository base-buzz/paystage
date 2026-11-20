/**
 * The x402 batch-settlement contract the channel records live in.
 *
 * Verified with `eth_getCode` on 2026-11-20: code present on Base mainnet
 * (chain id 8453) and Base Sepolia (84532), same deterministic address on both.
 * The contract was found from the deployed `@x402/evm` package
 * (`BATCH_SETTLEMENT_ADDRESS`), not from a project deployment.
 */
export const BATCH_SETTLEMENT_ADDRESS =
  "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as const;

/**
 * Only the two view functions this package calls are declared. There is
 * deliberately no write fragment, no `deposit`, `claim`, `settle`,
 * `initiateWithdraw`, `finalizeWithdraw` or `refund` here.
 */
export const CHANNEL_READ_ABI = [
  {
    type: "function",
    name: "channels",
    stateMutability: "view",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "balance", type: "uint128" },
      { name: "totalClaimed", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "pendingWithdrawals",
    stateMutability: "view",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "amount", type: "uint128" },
      { name: "initiatedAt", type: "uint40" },
    ],
  },
] as const;

/** `channels(bytes32)` */
export const CHANNELS_SELECTOR = "0x7a7ebd7b" as const;
/** `pendingWithdrawals(bytes32)` */
export const PENDING_WITHDRAWALS_SELECTOR = "0xb7f06ebe" as const;
