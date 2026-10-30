import { humanToAtomic } from "@paystage/policy";
import { z } from "zod";
import { checkVelocity } from "./check.js";
import { parseVelocityPolicy } from "./parse.js";
import type { VelocityAction, VelocityResult } from "./types.js";

/**
 * Input schema for the `evaluate_velocity` MCP tool.
 *
 * Amounts may be provided either as `amount_atomic` (decimal string of atomic
 * units) or as `amount` + `decimals` (human decimal string). Exactly one form
 * must be present per action.
 */
export const VelocityActionInputSchema = z
  .object({
    id: z.string().optional(),
    timestamp_ms: z.number().int().nonnegative(),
    amount_atomic: z.string().optional(),
    amount: z.string().optional(),
    decimals: z.number().int().nonnegative().optional(),
    asset: z.string().optional(),
  })
  .refine(
    (a) =>
      (a.amount_atomic !== undefined) !==
      (a.amount !== undefined && a.decimals !== undefined),
    {
      message:
        "provide exactly one of amount_atomic or (amount + decimals)",
    },
  );

export const EvaluateVelocityInputSchema = z.object({
  history: z.array(VelocityActionInputSchema).default([]),
  proposed: VelocityActionInputSchema,
  policy: z.unknown().optional(),
  policy_path: z.string().optional(),
  now_ms: z.number().int().nonnegative().optional(),
});

export type EvaluateVelocityInput = z.infer<typeof EvaluateVelocityInputSchema>;

function toAtomic(input: z.infer<typeof VelocityActionInputSchema>): bigint {
  if (input.amount_atomic !== undefined) {
    const s = input.amount_atomic.trim();
    if (!/^-?\d+$/.test(s)) {
      throw new Error(`invalid amount_atomic: ${input.amount_atomic}`);
    }
    return BigInt(s);
  }
  // amount + decimals
  return humanToAtomic(input.amount!, input.decimals!);
}

function toAction(
  input: z.infer<typeof VelocityActionInputSchema>,
): VelocityAction {
  return {
    id: input.id,
    timestamp_ms: input.timestamp_ms,
    amount_atomic: toAtomic(input),
    asset: input.asset,
  };
}

/**
 * Evaluate velocity for a proposed action against history and a policy.
 * Pure aside from optional policy file read when `policy_path` is provided.
 */
export async function evaluateVelocity(
  input: EvaluateVelocityInput,
): Promise<VelocityResult> {
  let policy: unknown = input.policy;

  if (policy === undefined && input.policy_path !== undefined) {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(input.policy_path, "utf8");
    policy = JSON.parse(raw);
  }

  const windows = parseVelocityPolicy(policy);
  const history = input.history.map(toAction);
  const proposed = toAction(input.proposed);

  return checkVelocity({
    history,
    proposed,
    windows,
    now_ms: input.now_ms,
  });
}

/**
 * Serialize a VelocityResult to a JSON-safe object (BigInt -> string).
 */
export function serializeVelocityResult(result: VelocityResult): unknown {
  return {
    decision: result.decision,
    reasons: result.reasons,
    windows_checked: result.windows_checked.map((w) => ({
      window_seconds: w.window_seconds,
      count: w.count,
      amount_atomic: w.amount_atomic.toString(),
      max_count: w.max_count,
      max_amount_atomic: w.max_amount_atomic?.toString(),
      count_ok: w.count_ok,
      amount_ok: w.amount_ok,
      passed: w.passed,
    })),
  };
}

