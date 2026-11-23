/**
 * What counts as a "correct 402" — one definition, so a number quoted next month means the same thing as this month's.
 *
 * The 2026-11-23 checked-seller run used *payee present + numeric amount + parseable payment-required header*, chosen mid-run. The figure it produced ("97 of 100") is
 * only comparable to a future one if the predicate is identical, so it lives here with fixtures rather than in a researcher's head.
 *
 * Deliberately narrow: this answers "did the endpoint quote a price and a payee in a form a client can read". It says nothing about honesty, delivery, or whether the
 * endpoint still answers tomorrow — those are different questions and this module must not be stretched to answer them.
 */
import { decodePaymentRequiredHeader } from "./index.js";

export interface CorrectChallenge {
  correct: boolean;
  /** Why it failed, in the words the caller should log. Empty when `correct` is true. */
  reason: string;
  payTo: string | null;
  amount: string | null;
}

/** A numeric amount is required: `"0.01"` and `"10000"` both count, `"free"` and `""` do not. */
function numericAmount(value: unknown): value is string | number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return value.trim() !== "" && Number.isFinite(Number(value));
  return false;
}

/**
 * Evaluate one 402 the way the checked-seller run did.
 *
 * @param headerValue the raw `payment-required` header, or null when the endpoint sent none
 * @param body the parsed JSON body, when the endpoint answers with a challenge in the body instead
 */
export function isCorrectChallenge(headerValue: string | null, body?: unknown): CorrectChallenge {
  const missing = (reason: string, payTo: string | null = null, amount: string | null = null): CorrectChallenge => ({
    correct: false,
    reason,
    payTo,
    amount,
  });

  const parsed = headerValue === null ? null : (decodePaymentRequiredHeader(headerValue) as Record<string, unknown> | null);
  const source = (parsed ?? (body as Record<string, unknown> | undefined) ?? null) as Record<string, unknown> | null;
  if (source === null) return missing("no parseable payment-required header or body");

  const accepts = Array.isArray(source.accepts) ? (source.accepts as Record<string, unknown>[]) : [];
  const accept = accepts[0];
  if (!accept) return missing("no accepts entry to read a payee or price from");

  const payTo = typeof accept.payTo === "string" && accept.payTo.trim() !== "" ? accept.payTo : null;
  const rawAmount = accept.amount ?? accept.maxAmountRequired;
  const amount = rawAmount === undefined || rawAmount === null ? null : String(rawAmount);

  if (payTo === null) return missing("no payee in the challenge", null, amount);
  if (!numericAmount(rawAmount)) return missing("the amount is not numeric, so a client cannot read a price", payTo, amount);

  return { correct: true, reason: "", payTo, amount };
}
