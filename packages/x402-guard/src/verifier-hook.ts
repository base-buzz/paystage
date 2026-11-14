/**
 * The server side of the same decision, as an x402 resource-server extension.
 *
 * `guardFetch` protects an agent that pays. This protects a seller that is about to be paid: it plugs
 * into the hooks `@x402/core` runs *before* verification, so a payment that violates the seller's
 * policy is aborted before the facilitator is asked to verify or settle it.
 *
 *   const server = new x402ResourceServer(facilitator)
 *     .registerExtension(paystageVerifierHook({ policy }));
 *
 * Why a hook rather than a wrapper: for anyone already on the SDK it is one object, and it runs at the
 * only point where the money has not moved yet. It cannot be skipped by a caller who forgot to use our
 * client — which is the failure mode a client-side guard always has.
 *
 * Fail closed. If policy evaluation throws, the payment is aborted with a reason. A hook that failed
 * open would be worse than no hook: it would look like protection and behave like consent.
 */

import { evaluatePayment } from "@paystage/preflight";
import type { Verdict } from "./index.js";

/** The subset of x402's requirements this needs. Declared locally so the package stays dependency-free. */
export interface PaymentRequirementsLike {
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  amount?: string;
  payTo?: string;
  asset?: string;
  resource?: string;
  description?: string;
}

export interface VerifyContextLike {
  paymentPayload: unknown;
  requirements: PaymentRequirementsLike;
}

export interface VerifierHookOptions {
  /** Same policy document as the rest of the suite. */
  policy: unknown;
  /** `pay` (default) lets `review` through; any other value aborts on it. */
  onReview?: "pay" | "refuse";
  /** Called with every decision, for logging or receipts. */
  onDecision?: (decision: { verdict: Verdict; reasonCodes: string[]; payTo?: string }) => void;
}

export type HookOutcome =
  | void
  | { abort: true; reason: string; message?: string };

/**
 * Run the gate for one verification attempt.
 *
 * Exported separately from the extension so the logic can be tested without constructing an x402
 * resource server — and so a caller with a different hook system can reuse it.
 */
export async function evaluateVerification(
  context: VerifyContextLike,
  options: VerifierHookOptions,
): Promise<HookOutcome> {
  const { requirements } = context;
  const amount = requirements.amount ?? requirements.maxAmountRequired;

  // x402 v2 reports USDC in atomic units; the policy speaks dollars. 6 decimals is USDC's, and a
  // requirement that cannot be expressed in dollars is refused rather than guessed at.
  const value = amount && /^\d+$/.test(amount) ? (Number(amount) / 1e6).toFixed(6) : null;
  if (value === null) {
    return {
      abort: true,
      reason: "paystage_unreadable_amount",
      message: "the payment requirement carries no atomic amount this gate can price",
    };
  }

  try {
    // x402's verify context hands us one already-matched requirement, so the request is a single
    // accept — the evaluator's job is to judge that one, not to pick among several.
    const result = evaluatePayment(
      {
        x402Version: 2,
        accepts: [
          {
            scheme: requirements.scheme ?? "exact",
            network: requirements.network ?? "",
            // The evaluator's native shape uses `amount` in atomic units; x402's verify context says
            // `maxAmountRequired` (v1) or `amount` (v2). Accept either and normalise once here.
            amount,
            maxTimeoutSeconds: 300,
            payTo: requirements.payTo ?? "",
            asset: requirements.asset ?? "",
            extra: { resource: requirements.resource ?? "", description: requirements.description ?? "" },
          },
        ],
        resource: { url: requirements.resource ?? "", description: requirements.description ?? "" },
      } as never,
      options.policy as never,
    );

    const verdict = result.decision as Verdict;
    const reasonCodes = result.reasons ?? [];
    options.onDecision?.({ verdict, reasonCodes, payTo: requirements.payTo });

    const refuse = verdict === "do_not_pay" || (verdict === "review" && options.onReview !== "pay");
    if (!refuse) return;

    return {
      abort: true,
      reason: reasonCodes[0] ?? `paystage_${verdict}`,
      message: `paystage refused this payment (${verdict}): ${reasonCodes.join(", ") || "no rule matched"}`,
    };
  } catch (err) {
    // Fail closed, and name why. This is the branch the test exercises deliberately.
    return {
      abort: true,
      reason: "paystage_evaluation_failed",
      message: `the policy could not be evaluated, so the payment was refused: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * The extension object `@x402/core` registers on a resource server.
 *
 * `key` is required by the SDK; it is also what appears in a challenge's `extensions` map, so a client
 * can see that the seller runs this gate before it signs.
 */
export function paystageVerifierHook(options: VerifierHookOptions) {
  return {
    key: "paystage-verifier",
    hooks: {
      beforeVerify: (context: VerifyContextLike) => evaluateVerification(context, options),
    },
  };
}
