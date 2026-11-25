/**
 * Evaluate one payment against a mandate (#412).
 *
 * The point of a refusal is that the seller can act on it. Every denial names the mandate rule that
 * failed — `per-payment`, `window`, `payee` or `expiry` (and `revoked` when the caller supplied the
 * revocation) — and quotes the numbers that produced it. "Outside mandate" alone is not actionable,
 * so it is not an outcome this function can return.
 *
 * This is scope evaluation, not signature verification. It is synchronous and pure so it can run in
 * the existing evaluator; the caller must call `verify()` first and pass a mandate it trusts. The
 * reason strings are still computed from the object in front of it, not from a claim about it.
 */

import { atomicToHuman, humanToAtomic } from "@paystage/policy";
import type { Mandate, Revocation } from "./types.js";

/** The payment terms, with the asset decimals needed to read the decimal scope amounts. */
export interface MandatePayment {
  /** Atomic units as a string, e.g. "3000000" for 3.00 USDC at 6 decimals. */
  amount: string;
  payee: string;
  /** Decimals of the asset this payment is denominated in. */
  decimals: number;
  /** Optional ticker for readable reasons, e.g. "USDC". */
  symbol?: string;
}

/** One settled payment already made under this mandate, for the rolling-window total. */
export interface MandateSpend {
  /** Atomic units as a string. */
  amount: string;
  /** ISO 8601 instant the payment settled. */
  at: string;
  payee?: string;
}

export interface EvaluateMandateInput {
  mandate: Mandate;
  payment: MandatePayment;
  /**
   * Payments already settled inside the window. The evaluator keeps no history of its own; an omitted
   * history means "no recorded spend", which is the only honest reading of an empty ledger.
   */
  history?: readonly MandateSpend[];
  /** Verified revocation statements. A matching serial denies before expiry is considered. */
  revocations?: readonly Revocation[];
  /** Injectable clock for expiry and window tests. */
  now?: Date;
}

/** The rule names a refusal can carry. They are stable strings, not prose to be parsed. */
export type MandateRule = "per-payment" | "window" | "payee" | "expiry" | "revoked" | "malformed";

export type MandateEvaluation =
  | { ok: true; mandate: Mandate }
  | { ok: false; rule: MandateRule; reason: string };

function format(amount: bigint, payment: MandatePayment): string {
  const human = atomicToHuman(amount, payment.decimals);
  return payment.symbol === undefined ? human : `${human} ${payment.symbol}`;
}

/** EVM addresses are case-insensitive; Solana base58 is not. Compare accordingly. */
function payeeEq(a: string, b: string): boolean {
  if (a.startsWith("0x") && b.startsWith("0x")) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function denied(rule: MandateRule, reason: string): MandateEvaluation {
  return { ok: false, rule, reason };
}

/**
 * Apply the mandate's four scope rules to a single payment.
 *
 * A malformed scope or history fails closed with a named rule rather than throwing: a seller that
 * cannot read the cap must not serve.
 */
export function evaluateMandate(input: EvaluateMandateInput): MandateEvaluation {
  const { mandate, payment } = input;
  const now = input.now ?? new Date();

  if (mandate === null || typeof mandate !== "object") {
    return denied("malformed", "mandate.malformed: mandate is not an object");
  }
  if (mandate.scope === null || typeof mandate.scope !== "object") {
    return denied("malformed", "mandate.malformed: mandate carries no scope");
  }

  // Expiry first: a dead authority is not a scope question.
  const expiresAt = Date.parse(mandate.expires_at);
  if (Number.isNaN(expiresAt)) {
    return denied("malformed", `mandate.malformed: expires_at is not a parseable timestamp: ${JSON.stringify(mandate.expires_at)}`);
  }
  if (now.getTime() > expiresAt) {
    const seconds = Math.round((now.getTime() - expiresAt) / 1000);
    return denied("expiry", `mandate.expiry: mandate expired ${seconds}s ago (${mandate.expires_at})`);
  }

  // A revocation outranks expiry on the hosted lookup, and it outranks it here for the same reason.
  const revocation = (input.revocations ?? []).find((entry) => entry?.serial === mandate.serial);
  if (revocation !== undefined) {
    return denied("revoked", `mandate.revoked: revocation statement at ${revocation.revoked_at} names serial ${mandate.serial}`);
  }

  let amount: bigint;
  try {
    if (!/^\d+$/.test(payment.amount)) throw new Error("not an atomic integer");
    amount = BigInt(payment.amount);
  } catch {
    return denied("malformed", `mandate.malformed: payment amount ${JSON.stringify(payment.amount)} is not an atomic integer`);
  }

  if (mandate.scope.allowed_payees !== undefined) {
    if (!mandate.scope.allowed_payees.some((allowed) => payeeEq(allowed, payment.payee))) {
      return denied(
        "payee",
        `mandate.payee: payee ${payment.payee} is not in the mandate's allowed_payees`,
      );
    }
  }

  let perPayment: bigint;
  let windowAmount: bigint;
  try {
    perPayment = humanToAtomic(mandate.scope.per_payment, payment.decimals);
    windowAmount = humanToAtomic(mandate.scope.window_amount, payment.decimals);
  } catch (error) {
    return denied(
      "malformed",
      `mandate.malformed: the scope amount cannot be read at ${payment.decimals} decimals (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  if (amount > perPayment) {
    return denied(
      "per-payment",
      `mandate.per-payment: amount ${format(amount, payment)} exceeds per_payment ${mandate.scope.per_payment}${payment.symbol === undefined ? "" : ` ${payment.symbol}`}`,
    );
  }

  const cutoff = now.getTime() - mandate.scope.window_seconds * 1000;
  let spent = 0n;
  for (const entry of input.history ?? []) {
    const at = Date.parse(entry.at);
    if (Number.isNaN(at)) {
      return denied(
        "malformed",
        `mandate.malformed: spend history entry at ${JSON.stringify(entry.at)} is not a parseable timestamp, so the window cannot be computed`,
      );
    }
    if (at <= cutoff) continue;
    if (!/^\d+$/.test(entry.amount)) {
      return denied(
        "malformed",
        `mandate.malformed: spend history amount ${JSON.stringify(entry.amount)} is not an atomic integer`,
      );
    }
    spent += BigInt(entry.amount);
  }

  const total = spent + amount;
  if (total > windowAmount) {
    return denied(
      "window",
      `mandate.window: ${format(total, payment)} in the last ${mandate.scope.window_seconds}s exceeds window_amount ${mandate.scope.window_amount}${payment.symbol === undefined ? "" : ` ${payment.symbol}`} (this payment ${format(amount, payment)})`,
    );
  }

  return { ok: true, mandate };
}
