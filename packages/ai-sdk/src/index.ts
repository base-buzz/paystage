/**
 * @paystage/ai-sdk — the preflight decision, as AI SDK tools.
 *
 * The AI SDK makes it easy to give a model a wallet and a set of tools. That combination has an
 * obvious failure: a model that can pay can pay the wrong party, in the wrong asset, too often. These
 * tools answer that question inside the same loop, before anything is signed.
 *
 *   import { paystageTools } from '@paystage/ai-sdk'
 *
 *   const result = await generateText({
 *     model: gateway('openai/gpt-5-mini'),
 *     tools: { ...paystageTools({ policy }), ...yourPaymentTools },
 *     prompt: 'Buy the weather data, but not above 2 cents.',
 *   })
 *
 * The tools are read-only by construction: none of them signs, holds a key, or moves money. The model
 * gets a verdict and the rule that produced it; the signing stays wherever it already lives.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { evaluatePayment } from "@paystage/preflight";

/** Same shape the hosted endpoint and the MCP server accept. */
export type PolicyInput = unknown;

export interface PaystageToolsOptions {
  /** Policy document (schema: @paystage/policy). Validated on first call, not at construction. */
  policy: PolicyInput;
  /** `pay` lets a `review` verdict proceed; anything else treats it as a refusal. Default `pay`. */
  onReview?: "pay" | "refuse";
}

const paymentRequiredSchema = z
  .object({})
  .passthrough()
  .describe(
    "The decoded x402 PaymentRequired object — the 402 challenge the agent is considering signing",
  );

const verdictSchema = {
  decision: z.enum(["pay", "review", "do_not_pay"]),
  reasons: z.array(z.string()),
  summary: z.string(),
};

/**
 * The four tools. Exported as a factory rather than a constant because the policy is per-agent: two
 * agents with different budgets must not share one evaluation, and a module-level policy would make
 * that mistake easy.
 */
export function paystageTools(options: PaystageToolsOptions): ToolSet {
  const onReview = options.onReview ?? "pay";

  const refuse = (decision: string) =>
    decision === "do_not_pay" || (decision === "review" && onReview === "refuse");

  const evaluate = tool({
    description:
      "Decide whether an x402 payment should be signed: returns pay, review or do_not_pay with the " +
      "rules that fired. Call this before paying anything. Read-only: it never signs.",
    inputSchema: z.object({
      payment_required: paymentRequiredSchema,
      agent_id: z.string().optional().describe("Which agent is asking, for per-agent budgets"),
    }),
    execute: async ({ payment_required, agent_id }) => {
      const result = evaluatePayment(
        payment_required as never,
        options.policy as never,
        agent_id ? ({ agentId: agent_id } as never) : undefined,
      ) as { decision: "pay" | "review" | "do_not_pay"; reasons: string[]; summary: string };

      return {
        decision: result.decision,
        reasons: result.reasons ?? [],
        summary: result.summary ?? "",
      };
    },
  });

  const check = tool({
    description:
      "One-word answer for a payment: should_pay or refuse, applying the configured review policy. " +
      "Use when the model only needs the decision, not the reasoning.",
    inputSchema: z.object({
      payment_required: paymentRequiredSchema,
      agent_id: z.string().optional(),
    }),
    execute: async ({ payment_required, agent_id }) => {
      const result = evaluatePayment(
        payment_required as never,
        options.policy as never,
        agent_id ? ({ agentId: agent_id } as never) : undefined,
      ) as { decision: string; reasons?: string[] };
      return {
        allowed: !refuse(result.decision),
        decision: result.decision,
        reasons: result.reasons ?? [],
      };
    },
  });

  return {
    paystage_evaluate_payment: evaluate,
    paystage_should_pay: check,
  };
}

export { verdictSchema };
