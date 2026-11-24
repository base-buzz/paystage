export type UnknownPayee = "review" | "deny";

export interface AmountSpec {
  value: string;
  asset: string;
  decimals: number;
}

export interface Asset {
  symbol: string;
  decimals: number;
  address: string;
  /** Omitted means "this address on any network the policy allows" (#37). */
  network?: string;
}


export interface VelocityAmountSpec {
  value: string;
  decimals: number;
  asset?: string;
}

/**
 * How a principal can answer a step-up **without a browser** (#414).
 *
 * The human path is a fallback, not the default: an agent whose seller demands stronger attestation at 3am must be
 * able to satisfy it from the authority it was given before it started. Each answer names a mechanism, not a vendor:
 *
 *  - `pre_signed_allowance` — a mandate/allowance the principal signed in advance, scoped to a payee, an amount and
 *    an expiry. The runtime presents it; the signer verifies it. No interactive approval.
 *  - `second_key` — a co-signature from a second key the principal controls, so one compromised agent key alone
 *    cannot authorise the payment.
 *  - `bounded_auto_approve` — a pre-agreed bounded auto-approval (for example a small per-day step-up budget) that
 *    the principal configured while it was present.
 */
export type StepUpAnswer = "pre_signed_allowance" | "second_key" | "bounded_auto_approve";

/**
 * Risk-based friction: the thresholds above which a `pay` becomes a `review` that asks for **stronger attestation**
 * (#414).
 *
 * This is a policy rule, not a fourth verdict. When a threshold fires, the evaluator still returns `review`; the
 * reason names the threshold (`step_up.amount`, `step_up.unknown_payee`, `step_up.first_payment`) and the result
 * carries a `StepUpRequirement` saying which non-interactive answers the principal pre-authorised.
 *
 * At least one threshold must be configured. `unknown_payee` and `first_payment_from_payer` are novelty checks and
 * need the caller's recorded payment history; absent history is treated as "no evidence", so the novelty thresholds
 * fire rather than silently passing.
 */
export interface StepUpSpec {
  /** `review` when the payment amount is strictly above this ceiling, in this asset's units. */
  amount_above?: AmountSpec;
  /** `review` when the payer has no recorded payment to this payee before now. */
  unknown_payee?: boolean;
  /** `review` when the payer has no recorded settled payment at all — the cold-start case. */
  first_payment_from_payer?: boolean;
  /**
   * Non-interactive ways the principal may answer. Omitted means all three. An empty list is rejected: a step-up
   * with no non-browser answer is the outage the design constraint forbids.
   */
  answers?: StepUpAnswer[];
}

export interface VelocityWindow {
  /** Rolling window length in seconds (e.g. 300, 1800, 18000). */
  window_seconds: number;
  /** Max number of transactions allowed in the window. */
  max_count?: number;
  /** Max aggregate amount allowed in the window. */
  max_amount?: VelocityAmountSpec;
  /**
   * Max amount for a single payee inside the window (#39). The aggregate ceiling does not stop one compromised seller
   * address whose payments are individually small and spread across the day.
   */
  per_payee_max_amount?: VelocityAmountSpec;
}

export interface Policy {
  version: 1;
  max_amount: AmountSpec;
  daily_cap?: AmountSpec;
  allowed_pay_to: string[];
  allowed_assets: Asset[];
  allowed_networks: string[];
  max_timeout_seconds: number;
  require_human_above?: AmountSpec;
  /**
   * Optional risk-based friction (#414). Each configured threshold turns a would-be `pay` into a `review` whose
   * reason names the threshold, and whose requirement lists the principal's non-interactive answers.
   */
  step_up?: StepUpSpec;
  unknown_payee: UnknownPayee;
  max_auth_validity_seconds?: number;
  allowed_spenders?: string[];
  disallow_unlimited_approvals?: boolean;
  /** Optional rolling-window rate and spend-pattern limits. */
  velocity?: { windows: VelocityWindow[] };
  /**
   * Per-agent narrowing overlays. When present, a caller must pass a known
   * `agent_id`; an override may only tighten the fields above, never loosen them.
   */
  agents?: Record<string, import("./agents.js").AgentBudget>;
}

