/**
 * The payment-terms digest (#443).
 *
 * ## Why this is not the EIP-3009 / EIP-712 digest
 *
 * `@paystage/x402-guard/signer` refuses to sign unless the gate's receipt carries the digest of the
 * payment it approved. The natural value would be `hashTypedData()` over the EIP-3009
 * `TransferWithAuthorization` the account is about to sign — but that value **cannot be computed at
 * evaluation time**. The typed data carries `from`, `nonce`, `validAfter` and `validBefore`; none of
 * those are in a 402 challenge. The client picks the 32-byte nonce per attempt, and the payer picks
 * the validity window, so a gate that signed an EIP-712 digest would have to invent them. Hashing
 * invented typed data produces a digest the adapter will never reproduce: exactly the "refuses every
 * payment" failure this row exists to end.
 *
 * So the gate and the adapter share a digest over the terms **both of them can see**, and the
 * adapter's comparison is updated to use this function as well. It covers the five fields that
 * decide who is paid, how much, in what asset, on what network and under what scheme:
 *
 *   SHA-256( canonical JSON of { domain, scheme, network, asset, amount, payee } )
 *
 * - `domain` is `paystage.payment-terms.v1`, so this digest cannot collide with the EIP-712 digest
 *   or with the receipt's `request_sha256` / `policy_sha256` even if the bytes coincide.
 * - `scheme` and `network` are lowercased; addresses (`asset`, `payee`) are lowercased so a
 *   checksummed challenge and a checksummed typed-data field hash the same bytes.
 * - `amount` is normalised through `BigInt` to a decimal atomic-units string, so `"02000"`, `"0x7d0"`
 *   and a typed-data `2000n` all produce `"2000"`.
 * - The result is lowercase 64-hex **without** `0x`, the shape `payment_digest` uses.
 *
 * ## What it binds, and what it does not
 *
 * It binds the exact amount, payee, asset, network and scheme the verdict was issued for. It does
 * **not** bind `from`, `nonce`, `validAfter` or `validBefore` — those are chosen at signing time and
 * are not in the challenge. A receipt replay against a fresh nonce with identical terms is therefore
 * not detected by this digest; the receipt's short lifetime and the adapter's terms check are what
 * bound that window. This is stated here rather than left for a reader to infer.
 */

import { sha256Hex } from "./evidence.js";

/** Domain separation for the terms digest. Changing it is a format change. */
export const PAYMENT_DIGEST_DOMAIN = "paystage.payment-terms.v1";

/**
 * The payment terms a gate can know from a 402 challenge and an adapter can derive from EIP-3009
 * typed data. Structurally matches both `AcceptOption` (plus its `payTo` name) and
 * `PaymentAuthorization` use at the call site.
 */
export interface PaymentTerms {
  scheme: string;
  network: string;
  asset: string;
  /** Atomic units, decimal string. */
  amount: string;
  payee: string;
}

function required(name: keyof PaymentTerms, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`payment terms: ${name} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * The exact object that is hashed. Exported so a caller can inspect or reproduce the bytes rather
 * than reimplement the normalisation and quietly disagree with it.
 */
export function canonicalPaymentTerms(terms: PaymentTerms): Record<string, string> {
  const scheme = required("scheme", terms.scheme).toLowerCase();
  const network = required("network", terms.network).toLowerCase();
  const asset = required("asset", terms.asset).toLowerCase();
  const payee = required("payee", terms.payee).toLowerCase();
  const rawAmount = required("amount", terms.amount);
  let amount: string;
  try {
    const parsed = BigInt(rawAmount);
    if (parsed < 0n) throw new Error("negative");
    amount = parsed.toString();
  } catch {
    throw new Error(`payment terms: amount is not a non-negative integer (${JSON.stringify(rawAmount)})`);
  }
  return { domain: PAYMENT_DIGEST_DOMAIN, scheme, network, asset, amount, payee };
}

/** The lowercase 64-hex payment-terms digest of one payment. */
export async function paymentTermsDigest(terms: PaymentTerms): Promise<string> {
  return sha256Hex(canonicalPaymentTerms(terms));
}
