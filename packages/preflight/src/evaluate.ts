import {
  humanToAtomic,
  atomicToHuman,
  resolveAgentPolicy,
  type Policy,
  type Asset,
} from "@paystage/policy";
import { isKnownDrainer } from "./known-drainers.js";

export interface AcceptOption {
  scheme: string;
  network: string;
  amount: string; // ATOMIC
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentResource {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequest {
  x402Version: number;
  accepts: AcceptOption[];
  error?: string;
  resource?: PaymentResource;
}

export type Decision = "pay" | "review" | "do_not_pay";
export type AcceptStatus = "pay" | "review" | "do_not_pay";

export interface AcceptResult {
  accept: AcceptOption;
  status: AcceptStatus;
  reasons: string[];
}

export interface EvaluateResult {
  decision: Decision;
  selectedAccept?: AcceptOption;
  acceptResults: AcceptResult[];
  reasons: string[];
  summary: string;
  dailyCapNote?: string;
}

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function findAsset(
  policy: Policy,
  network: string,
  assetAddress: string,
): Asset | undefined {
  return policy.allowed_assets.find(
    (a) => eq(a.network, network) && eq(a.address, assetAddress),
  );
}

function evaluateAccept(accept: AcceptOption, policy: Policy): AcceptResult {
  const reasons: string[] = [];

  // Rule 2: network allowlist
  const networkAllowed = policy.allowed_networks.some((n) =>
    eq(n, accept.network),
  );
  if (!networkAllowed) {
    reasons.push(`network ${accept.network} not in allowed_networks`);
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 3: asset must match allowed_assets with same network
  const asset = findAsset(policy, accept.network, accept.asset);
  if (!asset) {
    reasons.push(
      `asset ${accept.asset} on ${accept.network} not in allowed_assets`,
    );
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 4: amount is atomic
  let amount: bigint;
  try {
    amount = BigInt(accept.amount);
  } catch {
    reasons.push(`invalid atomic amount ${accept.amount}`);
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 5: policy-level max_amount, only if asset symbol matches
  if (eq(policy.max_amount.asset, asset.symbol)) {
    // The ceiling is expressed in the unit of the asset this challenge actually matched —
    // NOT in `max_amount.decimals`. Those can disagree when a policy lists the same ticker
    // twice at different decimals, and a ceiling computed in one unit then compared against
    // an amount in another fails open: 400 tokens read as 0.04 against a 0.05 cap.
    // `max_amount.decimals` remains a parse-time cross-check; it must not define the unit.
    const maxAtomic = humanToAtomic(policy.max_amount.value, asset.decimals);
    if (amount > maxAtomic) {
      reasons.push(
        `amount ${atomicToHuman(amount, asset.decimals)} ${asset.symbol} exceeds max_amount ${policy.max_amount.value} ${policy.max_amount.asset}`,
      );
      return { accept, status: "do_not_pay", reasons };
    }
  }

  // Rule 6: timeout
  if (accept.maxTimeoutSeconds > policy.max_timeout_seconds) {
    reasons.push(
      `maxTimeoutSeconds ${accept.maxTimeoutSeconds} exceeds policy max_timeout_seconds ${policy.max_timeout_seconds}`,
    );
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 7a: known drainers — hard deny before unknown_payee review
  if (isKnownDrainer(accept.payTo)) {
    reasons.push("known drainer");
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 7: payee allowlist
  const payeeAllowed = policy.allowed_pay_to.some((p) => eq(p, accept.payTo));
  if (!payeeAllowed) {
    if (policy.unknown_payee === "deny") {
      reasons.push(`payTo ${accept.payTo} not in allowed_pay_to (deny)`);
      return { accept, status: "do_not_pay", reasons };
    }
    reasons.push(`payTo ${accept.payTo} not in allowed_pay_to (review)`);
    return { accept, status: "review", reasons };
  }

  // Rule 8: require_human_above
  if (policy.require_human_above) {
    const threshold = humanToAtomic(
      policy.require_human_above.value,
      policy.require_human_above.decimals,
    );
    if (amount > threshold) {
      reasons.push(
        `amount ${atomicToHuman(amount, asset.decimals)} ${asset.symbol} exceeds require_human_above ${policy.require_human_above.value} ${policy.require_human_above.asset}`,
      );
      return { accept, status: "review", reasons };
    }
  }

  return { accept, status: "pay", reasons };
}

function amountOf(accept: AcceptOption): bigint {
  try {
    return BigInt(accept.amount);
  } catch {
    return BigInt(0);
  }
}

function cheapest(accepts: AcceptOption[]): AcceptOption | undefined {
  if (accepts.length === 0) return undefined;
  return [...accepts].sort((a, b) => {
    const da = amountOf(a);
    const db = amountOf(b);
    if (da < db) return -1;
    if (da > db) return 1;
    return a.maxTimeoutSeconds - b.maxTimeoutSeconds;
  })[0];
}

export interface EvaluateOptions {
  /**
   * Which agent is asking. Required when the policy declares per-agent budgets:
   * a policy with agents must never fall back to the loosest rules in the file.
   */
  agentId?: string;
}

export function evaluatePayment(
  pr: PaymentRequest,
  policy: Policy,
  options: EvaluateOptions = {},
): EvaluateResult {
  // Rule 0: per-agent budgets. Resolve first — every later rule must run against the
  // narrowed policy, not the global one, or a cheap agent could be judged by the
  // expensive agent's ceiling.
  const resolution = resolveAgentPolicy(policy, options.agentId);
  if (!resolution.ok) {
    return {
      decision: "do_not_pay",
      acceptResults: [],
      reasons: [resolution.reason],
      summary: "Agent identity could not be resolved against the policy.",
    };
  }
  const effective = resolution.policy;
  // Rule 1: malformed
  if (!pr || pr.x402Version !== 2) {
    return {
      decision: "do_not_pay",
      acceptResults: [],
      reasons: [`unsupported x402Version ${pr?.x402Version}`],
      summary: "Payment request is malformed or unsupported version.",
    };
  }
  if (!Array.isArray(pr.accepts) || pr.accepts.length === 0) {
    return {
      decision: "do_not_pay",
      acceptResults: [],
      reasons: ["no accepts in payment request"],
      summary: "Payment request has no acceptable payment options.",
    };
  }

  const acceptResults = pr.accepts.map((a) => evaluateAccept(a, effective));

  const payAccepts = acceptResults
    .filter((r) => r.status === "pay")
    .map((r) => r.accept);
  const reviewAccepts = acceptResults
    .filter((r) => r.status === "review")
    .map((r) => r.accept);

  let decision: Decision;
  let selectedAccept: AcceptOption | undefined;
  if (payAccepts.length > 0) {
    decision = "pay";
    selectedAccept = cheapest(payAccepts);
  } else if (reviewAccepts.length > 0) {
    decision = "review";
    selectedAccept = cheapest(reviewAccepts);
  } else {
    decision = "do_not_pay";
  }

  const reasons: string[] = [];
  for (const r of acceptResults) {
    for (const reason of r.reasons) reasons.push(reason);
  }

  // Rule 9: daily_cap note only
  let dailyCapNote: string | undefined;
  if (policy.daily_cap) {
    dailyCapNote = `daily_cap ${policy.daily_cap.value} ${policy.daily_cap.asset} (informational only)`;
  }

  // Rule 12: summary
  let summary: string;
  if (selectedAccept) {
    const asset = findAsset(
      policy,
      selectedAccept.network,
      selectedAccept.asset,
    );
    const decimals = asset?.decimals ?? policy.max_amount.decimals;
    const human = atomicToHuman(BigInt(selectedAccept.amount), decimals);
    const symbol = asset?.symbol ?? policy.max_amount.asset;
    summary = `Decision: ${decision}. Selected ${human} ${symbol} on ${selectedAccept.network} to ${selectedAccept.payTo}.`;
  } else {
    summary = `Decision: ${decision}. No acceptable payment option.`;
  }

  return {
    decision,
    selectedAccept,
    acceptResults,
    reasons,
    summary,
    dailyCapNote,
  };
}
