import type { Policy } from "@paystage/policy";

/**
 * The extension's `info` object, exactly as it appears at
 * `PaymentRequired.extensions["payment-policy"].info`.
 *
 * `rules` is the `@paystage/policy` v1 body with `version` lifted one level, so the whole
 * policy survives the document. It is deliberately not a second schema: every field below
 * is the field name `@paystage/policy` already uses.
 */
export interface PolicyDocument {
  version: 1;
  rules: Omit<Policy, "version">;
}

/** The three words the draft's `verdict.decision` enumerates, plus the package's refusal to trust a verdict. */
export type Verdict = "pay" | "review" | "do_not_pay" | "unsupported";

/** A decision the draft defines. `unsupported` is never a value of `verdict.decision`. */
export type VerdictDecision = Exclude<Verdict, "unsupported">;

/**
 * The `verdict` object from `PaymentPayload.extensions["payment-policy"].verdict`.
 *
 * `rule_id` and `evaluator` are optional in the draft; an unknown extra field is ignored,
 * because a client echoing a newer revision must not be treated as hostile for that alone.
 */
export interface PaymentPolicyVerdict {
  decision: VerdictDecision;
  rule_id?: string;
  evaluator?: { name: string; version: string };
}
