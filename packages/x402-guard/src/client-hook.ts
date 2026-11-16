/**
 * The gate as an `@x402/core` client hook.
 *
 * `guardFetch` covers anyone paying through `x402-fetch`. Anyone driving `x402Client` directly — which is
 * what most SDK integrations do — got nothing, because the wrapper was one layer too high. Core exposes
 * `onBeforePaymentCreation`, which runs before a payment payload is created and can abort with a reason,
 * so the same gate belongs there as a single registration:
 *
 *   const client = x402Client.fromConfig({ schemes: [...] });
 *   client.onBeforePaymentCreation(paystageClientHook({ policy }));
 *
 * The same policy, the same verdicts, the same reason codes as every other surface in this project.
 */

import { evaluatePayment } from "@paystage/preflight";

export interface PaymentRequirementsLike {
  scheme?: string;
  network?: string;
  amount?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
}

export interface PaymentCreationContextLike {
  paymentRequired?: { x402Version?: number; accepts?: PaymentRequirementsLike[] };
  selectedRequirements?: PaymentRequirementsLike;
}

export interface ClientHookOptions {
  policy: unknown;
  /** `pay` lets a `review` verdict proceed; anything else treats it as a refusal. Default `pay`. */
  onReview?: "pay" | "refuse";
  /** Called with every decision, mirroring guardFetch's `onVerdict`. */
  onVerdict?: (v: { verdict: string; reasonCodes: string[]; payTo?: string; at: string }) => void;
}

export type ClientHookOutcome = void | { abort: true; reason: string };

/**
 * Run the gate for one payment-creation attempt.
 *
 * Exported separately from the hook factory so it can be tested — and reused — without constructing an
 * x402 client.
 */
export async function evaluateBeforeCreation(
  context: PaymentCreationContextLike,
  options: ClientHookOptions,
): Promise<ClientHookOutcome> {
  const requirements = context.selectedRequirements ?? context.paymentRequired?.accepts?.[0];
  if (!requirements) {
    return { abort: true, reason: "paystage_no_requirements" };
  }

  const amount = requirements.amount ?? requirements.maxAmountRequired;
  const value = amount && /^\d+$/.test(amount) ? (Number(amount) / 1e6).toFixed(6) : null;
  if (value === null) {
    // Unpriceable is not permission. A payment we cannot read is a payment we cannot judge.
    options.onVerdict?.({ verdict: "do_not_pay", reasonCodes: ["unreadable_amount"], at: new Date().toISOString() });
    return { abort: true, reason: "paystage_unreadable_amount" };
  }

  try {
    const result = evaluatePayment(
      {
        x402Version: 2,
        accepts: [
          {
            scheme: requirements.scheme ?? "exact",
            network: requirements.network ?? "",
            amount,
            asset: requirements.asset ?? "",
            payTo: requirements.payTo ?? "",
            maxTimeoutSeconds: requirements.maxTimeoutSeconds ?? 300,
          },
        ],
      } as never,
      options.policy as never,
    ) as { decision: string; reasons?: string[] };

    const verdict = result.decision;
    const reasonCodes = result.reasons ?? [];
    options.onVerdict?.({ verdict, reasonCodes, payTo: requirements.payTo, at: new Date().toISOString() });

    const refuse = verdict === "do_not_pay" || (verdict === "review" && options.onReview === "refuse");
    if (!refuse) return;
    return { abort: true, reason: reasonCodes[0] ?? `paystage_${verdict}` };
  } catch (error) {
    // Fail closed, and name why.
    const message = error instanceof Error ? error.message : String(error);
    options.onVerdict?.({ verdict: "do_not_pay", reasonCodes: ["evaluation_failed"], at: new Date().toISOString() });
    return { abort: true, reason: `paystage_evaluation_failed: ${message}` };
  }
}

/** The hook object to hand to `client.onBeforePaymentCreation(...)`. */
export function paystageClientHook(options: ClientHookOptions) {
  return (context: PaymentCreationContextLike) => evaluateBeforeCreation(context, options);
}
