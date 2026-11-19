import type { Action, Plugin, Provider, ActionResult } from "@elizaos/core";
import { evaluatePayment, normalizePaymentRequired } from "@paystage/preflight";
import type { Policy } from "@paystage/policy";

/**
 * PayStage for elizaOS: one action, one provider.
 *
 * The action answers the only question this project exists for — should this x402 payment be signed? — and returns the verdict as
 * data, not as an error, because an agent that cannot branch on a refusal will either ignore the plugin or turn it off.
 *
 * Deliberately no memory, no embeddings, no character changes: a plugin that does more than the gate is a plugin people disable.
 */
export type EvaluateConfig = {
  /** A policy document to judge against. Without one the action refuses rather than guessing. */
  policy?: Policy;
  /** Where to read the policy from in the runtime's settings, when no document is passed. */
  policySettingKey?: string;
};

const DEFAULT_SETTING = "PAYSTAGE_POLICY";

/** The policy for this run: the configured document first, then the runtime setting, then nothing. */
export function resolvePolicy(runtime: unknown, config: EvaluateConfig): Policy | null {
  if (config.policy) return config.policy;
  const settings = (runtime as { getSetting?: (key: string) => unknown } | undefined)?.getSetting;
  if (typeof settings === "function") {
    const raw = settings.call(runtime, config.policySettingKey ?? DEFAULT_SETTING);
    if (typeof raw === "string" && raw.trim().startsWith("{")) {
      try {
        return JSON.parse(raw) as Policy;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function paystagePlugin(config: EvaluateConfig = {}): Plugin {
  const evaluate: Action = {
    name: "EVALUATE_X402_PAYMENT",
    similes: ["CHECK_PAYMENT", "SHOULD_I_PAY", "PAYMENT_PREFLIGHT"],
    description:
      "Evaluate a proposed x402 payment before signing it. Returns pay, review or do_not_pay with the rule that fired. Use it " +
      "immediately before any payment an agent is about to make; do NOT use it to inspect outstanding allowances.",
    validate: async () => true,
    handler: async (runtime, message): Promise<ActionResult> => {
      const policy = resolvePolicy(runtime, config);
      if (!policy) {
        // Fail closed and say why: an agent without a policy has no ceiling, and guessing one is worse than refusing.
        return {
          success: false,
          text: "paystage: no policy configured — set PAYSTAGE_POLICY or pass one to the plugin. Refusing to guess a spend ceiling.",
          data: { decision: "review", reason: "no policy configured" },
        };
      }
      const raw = (message as { content?: { paymentRequired?: unknown } } | undefined)?.content?.paymentRequired;
      if (!raw) {
        return { success: false, text: "paystage: message.content.paymentRequired is required", data: { decision: "review" } };
      }
      try {
        const result = evaluatePayment(normalizePaymentRequired(raw as never), policy);
        return {
          success: true,
          text: `paystage: ${result.decision}${result.reasons?.length ? ` — ${result.reasons[0]}` : ""}`,
          data: { decision: result.decision, reasons: result.reasons ?? [] },
        };
      } catch (error) {
        // A malformed challenge is not a clean payment.
        return { success: false, text: `paystage: could not evaluate — ${String(error).slice(0, 120)}`, data: { decision: "review" } };
      }
    },
    examples: [],
  };

  const provider: Provider = {
    name: "PAYSTAGE_POLICY",
    get: async (runtime) => {
      const policy = resolvePolicy(runtime, config);
      if (!policy) return "No PayStage policy is configured; every evaluation will refuse and ask for one.";
      const cap = (policy as { max_amount?: { value?: string; asset?: string } }).max_amount;
      return `PayStage policy active: ceiling ${cap?.value ?? "?"} ${cap?.asset ?? ""}, ${policy.allowed_pay_to.length} allowed paye(e), networks ${policy.allowed_networks.join(", ")}.`;
    },
  };

  return {
    name: "paystage",
    description: "Payment safety for agents: ask whether an x402 payment should be signed before it is.",
    actions: [evaluate],
    providers: [provider],
  };
}

export default paystagePlugin;
