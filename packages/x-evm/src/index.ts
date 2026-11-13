/**
 * PayStage guard for `@x402/evm`.
 *
 * `@x402/evm` does the thing that matters and does it well: it builds and signs an EVM payment
 * payload. That is exactly why it cannot be the place a policy is enforced — by the time
 * `createPaymentPayload` runs, the decision has already been made to sign.
 *
 * This wraps that method. `createPaymentPayload(x402Version, requirements, context)` is the single
 * choke point every scheme variant goes through, so one wrapper covers `ExactEvmScheme`,
 * `UptoEvmScheme`, `BatchSettlementEvmScheme` and anything else that inherits it.
 *
 * A refusal is a thrown error, not a return value: a caller that ignores a return value would sign
 * anyway, and the whole point is that it cannot.
 */

import { evaluatePayment, normalizePaymentRequired } from "@paystage/preflight";
import type { Policy } from "@paystage/policy";

export interface GuardOptions {
  /** The policy to evaluate against. No policy means no payment — see `requirePolicy`. */
  policy: Policy;
  /** Called with every verdict, before the decision is enforced. Never receives a signature. */
  onVerdict?: (verdict: GuardVerdict) => void;
  /** Default true. When false, a `review` verdict is allowed through and only denials throw. */
  refuseReview?: boolean;
}

export interface GuardVerdict {
  decision: "pay" | "review" | "do_not_pay";
  reasons: Array<{ code: string; detail?: string }>;
  network?: string;
  amount?: string;
}

export class PaymentRefusedError extends Error {
  readonly verdict: GuardVerdict;
  constructor(verdict: GuardVerdict) {
    const codes = verdict.reasons.map((r) => r.code).join(", ") || "no reason given";
    super(`PayStage refused this payment (${verdict.decision}): ${codes}`);
    this.name = "PaymentRefusedError";
    this.verdict = verdict;
  }
}

/** The shape of the scheme method we wrap. Deliberately structural, not a dependency on its types. */
interface SchemeLike {
  createPaymentPayload(
    x402Version: number,
    paymentRequirements: unknown,
    context?: unknown,
  ): Promise<unknown>;
}

function toVerdict(result: ReturnType<typeof evaluatePayment>): GuardVerdict {
  // `@paystage/preflight` returns reasons as sentences, not coded objects — the sentence is what a
  // human reads in a log, so it is carried through unchanged rather than re-parsed into a code.
  const reasons = (result.reasons ?? []).map((text) => ({ code: String(text) }));
  return {
    decision: result.decision as GuardVerdict["decision"],
    reasons,
  };
}

/**
 * Wrap a scheme instance so its payload creation is gated.
 *
 * Returns the same object rather than a copy, so identity checks and `instanceof` keep working.
 */
export function guardScheme<T extends SchemeLike>(scheme: T, options: GuardOptions): T {
  const refuseReview = options.refuseReview !== false;
  const original = scheme.createPaymentPayload.bind(scheme);

  scheme.createPaymentPayload = async function guarded(x402Version, paymentRequirements, context) {
    const challenge = normalizePaymentRequired({
      x402Version,
      accepts: [paymentRequirements],
    } as never);

    const result = evaluatePayment(challenge as never, options.policy as never);
    const verdict = toVerdict(result);
    options.onVerdict?.(verdict);

    const blocked =
      verdict.decision === "do_not_pay" || (verdict.decision === "review" && refuseReview);
    if (blocked) throw new PaymentRefusedError(verdict);

    return original(x402Version, paymentRequirements, context);
  } as T["createPaymentPayload"];

  return scheme;
}

/** Convenience: construct a scheme already guarded. */
export function createGuardedScheme<T extends SchemeLike>(
  Scheme: new (...args: any[]) => T,
  args: ConstructorParameters<typeof Scheme>,
  options: GuardOptions,
): T {
  return guardScheme(new Scheme(...args), options);
}
