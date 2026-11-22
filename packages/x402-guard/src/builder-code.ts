/**
 * The builder code this project attaches to payments it causes.
 *
 * A builder code is Base's attribution string — 1–32 lowercase letters, digits or underscores — carried as a client extension on an x402 payment. It is
 * **public by nature**: it appears in the transaction it attributes, so it is a constant here rather than a secret in the credential store.
 *
 * Two honest caveats, both true on 2026-11-22:
 *
 * 1. **A string alone attributes nothing.** The code must be claimed under the project's Base account before the chain credits anything to it. Until that
 *    claim exists this constant attaches an extension and buys exactly no attribution.
 * 2. **Our only payment path today is the Sepolia soak**, which is testnet traffic. Attribution there is meaningless until there is mainnet volume we cause —
 *    so the value of wiring it is the day that volume exists, not today.
 *
 * Keeping the constant here means the day a path needs it, the string is already canonical and validated by `assertBuilderCode`.
 */
export const PAYSTAGE_BUILDER_CODE = "paystage";

/** The rule Base applies; exported so a caller can validate before a payment is attempted rather than after it fails. */
export const BUILDER_CODE_PATTERN = /^[a-z0-9_]{1,32}$/;

export function assertBuilderCode(code: string): string {
  if (!BUILDER_CODE_PATTERN.test(code)) {
    throw new Error(`builder code "${code}" must be 1-32 characters of lowercase letters, digits or underscores`);
  }
  return code;
}
