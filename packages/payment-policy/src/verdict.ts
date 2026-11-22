import type { Policy } from "@paystage/policy";
import type { PaymentPolicyVerdict, PolicyDocument, Verdict, VerdictDecision } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const VERDICT_DECISIONS = ["pay", "review", "do_not_pay"] as const;

/** The four values `evaluateVerdict` can return. The first three are the draft's words. */
export const VERDICTS = [...VERDICT_DECISIONS, "unsupported"] as const;

/**
 * A dotted identifier. The draft says `rule_id` is a "dotted identifier of the rule that
 * determined it" without naming a rule namespace; this package resolves it as a path into
 * the policy's `rules` object, so its vocabulary is the schema's field names.
 */
const RULE_ID = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

/**
 * Resolve a dotted path through the policy's rules.
 *
 * Arrays are transparent unless the segment is an index: `velocity.windows.max_count` matches
 * a window in `velocity.windows[]`, and `velocity.windows.0.max_count` names one window. A rule
 * id that does not resolve is not a rule this policy contains.
 */
function ruleExists(node: unknown, segments: string[]): boolean {
  if (segments.length === 0) return node !== undefined;
  // A rule id names a field, not an array slot: `allowed_pay_to.0` is a payee address, not a rule.
  if (/^\d+$/.test(segments[segments.length - 1])) return false;

  const [head, ...rest] = segments;
  if (Array.isArray(node)) {
    if (/^\d+$/.test(head)) {
      const index = Number(head);
      return index < node.length && ruleExists(node[index], rest);
    }
    return node.some((entry) => ruleExists(entry, segments));
  }

  if (!isRecord(node) || !Object.prototype.hasOwnProperty.call(node, head)) return false;
  return ruleExists(node[head], rest);
}

/** Accept either the flat policy or the document; the rule vocabulary is the same in both. */
function rulesOf(policy: Policy | PolicyDocument): Record<string, unknown> {
  if (!isRecord(policy)) return {};
  const maybeDocument = policy as unknown as Record<string, unknown>;
  if ("rules" in maybeDocument) {
    // A document with a non-object `rules` is malformed; returning no rules fails closed.
    return isRecord(maybeDocument.rules) ? maybeDocument.rules : {};
  }
  const { version: _version, ...rules } = maybeDocument;
  return rules;
}

/**
 * `evaluateVerdict(verdict, policy?)` → one of `pay`, `review`, `do_not_pay`, `unsupported`.
 *
 * The three decision words are the draft's, verbatim. `unsupported` is the package's fourth
 * outcome: the verdict is malformed, its decision is not one of the three, or its `rule_id`
 * does not name a rule in the supplied policy. A verdict is advisory in the draft, so this
 * function never throws on a bad verdict and never upgrades one to a trusted decision.
 *
 * The policy argument is optional so a decision without a `rule_id` can be classified alone.
 * If a `rule_id` is present and no policy is supplied, the result is `unsupported`: a rule
 * reference that cannot be checked is not evidence, and fail-closed is the only safe default.
 */
export function evaluateVerdict(verdict: unknown, policy?: Policy | PolicyDocument): Verdict {
  if (!isRecord(verdict)) return "unsupported";

  const decision = verdict.decision;
  if (decision !== "pay" && decision !== "review" && decision !== "do_not_pay") return "unsupported";

  const ruleId = verdict.rule_id;
  if (ruleId !== undefined) {
    if (typeof ruleId !== "string" || !RULE_ID.test(ruleId)) return "unsupported";
    if (policy === undefined) return "unsupported";
    if (!ruleExists(rulesOf(policy), ruleId.split("."))) return "unsupported";
  }

  const evaluator = verdict.evaluator;
  if (evaluator !== undefined) {
    if (
      !isRecord(evaluator) ||
      typeof evaluator.name !== "string" ||
      evaluator.name.length === 0 ||
      typeof evaluator.version !== "string" ||
      evaluator.version.length === 0
    ) {
      return "unsupported";
    }
  }

  return decision satisfies VerdictDecision;
}

export type { PaymentPolicyVerdict, Verdict, VerdictDecision };
