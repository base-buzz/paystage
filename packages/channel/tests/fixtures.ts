/**
 * Recorded `eth_call` responses, captured on 2026-11-20 at Base mainnet block
 * 59,972,547 from contract 0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003.
 *
 * The channel id is a real one seen in the contract's `Settled` / claim logs;
 * it is not invented. Values are token base units (USDC has 6 decimals):
 *   20001600 = 20.0016, 19958880 = 19.95888.
 *
 * These bytes are immutable test inputs. The package decodes them through the
 * same path it uses for a live RPC response.
 */
export const RECORDED_CHANNEL_ID =
  "0x1dc6371a716991c8eb1cd8fdff2c21ad56a3c2ca835c0a83b480c7cf7f88da93" as const;

export const RECORDED_BLOCK = 59_972_547;

/** `channels(channelId)` → (uint128 balance, uint128 totalClaimed) */
export const RECORDED_CHANNELS_HEX =
  "0x00000000000000000000000000000000000000000000000000000000013133400000000000000000000000000000000000000000000000000000000001308c60" as const;

/** `pendingWithdrawals(channelId)` → (uint128 amount, uint40 initiatedAt) */
export const RECORDED_PENDING_WITHDRAWALS_HEX =
  "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * SYNTHETIC — not chain data. This exercises the uint40 decode and the expiry
 * arithmetic; it is not presented as a live reading, and no live fixture is
 * faked from it. `initiatedAt = 1_700_000_000` and `amount = 5_000_000`.
 */
export const SYNTHETIC_PENDING_WITHDRAWALS_HEX =
  "0x00000000000000000000000000000000000000000000000000000000004c4b40000000000000000000000000000000000000000000000000000000006553f100" as const;

/**
 * A voucher field, also not an `eth_call`: `signedMaxClaimable` lives in the
 * payer/server's signed cumulative voucher, not in contract storage.
 */
export const VOUCHER_SIGNED_MAX_CLAIMABLE = "25000000" as const;
