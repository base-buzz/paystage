import {
  humanToAtomic,
  atomicToHuman,
  resolveAgentPolicy,
  type Policy,
  type Asset,
} from "@paystage/policy";
import { isKnownDrainer, isNonReceivable } from "./known-drainers.js";
import { SANCTIONED_ADDRESSES } from "./sanctioned-addresses.js";
import { verifiedPayeeFor } from "./verified-payees.js";

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
  /**
   * Which agent the policy was narrowed for, when one was supplied.
   *
   * Without it, two agents with different caps produce two verdicts that look identical in a log —
   * the operator can see a refusal but not whose budget it was. Absent means the global policy
   * applied, which is a different fact and must not be guessed at.
   */
  agent?: string;
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
  // An entry with no `network` matches the address on any allowed network (#37); the network allow-list is what bounds which
  // networks are reachable, so this cannot widen the policy beyond what the operator listed.
  return policy.allowed_assets.find(
    (a) =>
      (a.network === undefined || eq(a.network, network)) &&
      eq(a.address, assetAddress),
  );
}

function evaluateAccept(accept: AcceptOption, policy: Policy, resource?: PaymentResource): AcceptResult {
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

  // Rule 1.5: the payee must be a 20-byte hex address.
  //
  // An external trading agent found this on our own example: `0x6160…3757e` has 41 hex characters, and the
  // evaluator answered `pay` because the string matched the allow-list as text. A malformed address is either a
  // typo or a swap, and money sent to it is unrecoverable — so it is a refusal with a named reason, not a match.
  if (!ADDRESS_RE.test(String(accept.payTo ?? ""))) {
    reasons.push(
      `invalid payTo address: expected 0x plus 40 hex characters, got ${String(accept.payTo ?? "").length - 2}`,
    );
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 7a: known drainers — hard deny before unknown_payee review
  if (isKnownDrainer(accept.payTo)) {
    reasons.push("known drainer");
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 7a2: non-receivable sinks. Separate from the drainer list because the fact is different — paying
  // 0x…dEaD destroys the funds, nobody steals them. Same verdict, truthful reason, and the published drainer
  // list stops claiming a burn address is a thief.
  if (isNonReceivable(accept.payTo)) {
    reasons.push(`non-receivable payee ${accept.payTo} (funds are destroyed, not received)`);
    return { accept, status: "do_not_pay", reasons };
  }

  // Rule 7b: OFAC sanctions. Separate from the drainer list because the reason for refusing is different —
  // a drainer takes your funds, a sanctioned address may make paying *you* the violation. Both are hard
  // denies, and the reason code says which list fired so a human can check the citation.
  if (SANCTIONED_ADDRESSES.has(String(accept.payTo).toLowerCase())) {
    reasons.push("sanctioned address (OFAC SDN)");
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

  /**
   * Rule 7c: the payee matches the host's verified record, when we have one (#133 → #164).
   *
   * A challenge names both `resource` and `payTo`, and nothing ties them together: an endpoint can put any host in `resource` and
   * ask to be paid at an address it controls. When that host is one we have probed, a different payee is a fact worth stopping
   * for — `review`, not `do_not_pay`, because a provider may legitimately rotate its payee and refusing on rotation would punish
   * the honest case this registry exists to protect.
   */
  if (resource?.url) {
    let host: string | undefined;
    try {
      host = new URL(resource.url).host.toLowerCase();
    } catch {
      host = undefined;
    }
    const verified = verifiedPayeeFor(host);
    if (verified && verified.payee !== String(accept.payTo).toLowerCase()) {
      reasons.push(
        `payTo ${accept.payTo} differs from the verified address for ${verified.host} (${verified.payee}, verified ${verified.verified_at ?? "undated"}) — the endpoint may be a clone, or the provider rotated its payee`,
      );
      return { accept, status: "review", reasons };
    }
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
  /** Injectable clock, so a time-window test does not depend on when it runs. */
  now?: Date;
  /**
   * The client-supplied payment identifier from the x402 payment-identifier extension.
   *
   * When present, a `pay` verdict for an identifier we have already approved inside the window becomes `review` instead. The evaluator is stateless by design, and that statelessness
   * is the gap: an agent that times out after `pay` and retries the same logical purchase gets a second approval for a payment that may already be authorised (#187, issue #228).
   */
  paymentIdentifier?: string;
  /** How long an identifier stays "already judged". Ten minutes covers retry loops; a rebuy is a new challenge or a new identifier. */
  dedupWindowMs?: number;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Identifiers this process has already turned into a `pay` verdict, with the time it happened.
 *
 * In memory and per process, deliberately: the evaluator holds no keys and talks to no network, so a shared store would make a security decision depend on a second service being up.
 * The cost is honest and belongs in LIMITS.md — a restart forgets, and on a hosted deployment each isolate has its own view.
 */
const approvedIdentifiers = new Map<string, number>();
export const DEFAULT_DEDUP_WINDOW_MS = 10 * 60 * 1000;

/** Test hook: the cache is process-wide, and a test that leaks state between cases is a test that will one day pass for the wrong reason. */
export function resetPaymentIdentifierCache(): void {
  approvedIdentifiers.clear();
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
      ...(options.agentId !== undefined ? { agent: options.agentId } : {}),
    };
  }
  const effective = resolution.policy;
  const agent = options.agentId;
  // Rule 0.5: time windows. Policy-wide, not per-accept — the hour does not depend on which payment you choose.
  const window = (effective as { time_window?: { allowed_hours_utc?: [number, number]; blocked_hours_utc?: [number, number] } })
    .time_window;
  if (window) {
    const hour = (options.now ?? new Date()).getUTCHours();
    // Half-open, and wrapping when end <= start: [22, 6] means 22:00–05:59 UTC.
    const inRange = ([startH, endH]: [number, number]): boolean =>
      startH <= endH ? hour >= startH && hour < endH : hour >= startH || hour < endH;
    const denied =
      (window.allowed_hours_utc !== undefined && !inRange(window.allowed_hours_utc)) ||
      (window.blocked_hours_utc !== undefined && inRange(window.blocked_hours_utc));
    if (denied) {
      const [startH, endH] = (window.allowed_hours_utc ?? window.blocked_hours_utc) as [number, number];
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        decision: "do_not_pay",
        acceptResults: [],
        reasons: [`outside allowed hours: policy permits ${pad(startH)}:00–${pad(endH)}:00 UTC, now ${pad(hour)}:00 UTC`],
        summary: "Payment refused: outside the policy's time window.",
      };
    }
  }

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

  const acceptResults = pr.accepts.map((a) => evaluateAccept(a, effective, pr.resource));

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

  /**
   * Rule 11.5: a retried preflight is not a second approval.
   *
   * Only a `pay` is downgraded: repeating a refusal or a review changes nothing, and those verdicts are the ones an agent should be free to re-ask. The identifier is checked *before*
   * the summary is written so the human-readable line and the decision cannot disagree.
   */
  const identifier = options.paymentIdentifier?.trim();
  if (identifier && decision === "pay") {
    if (identifier.length > 128) {
      decision = "review";
      reasons.push(`payment_identifier is ${identifier.length} characters — refusing to cache a value that long; ask again with a stable, short id`);
    } else {
      const at = (options.now ?? new Date()).getTime();
      const window = options.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
      const seenAt = approvedIdentifiers.get(identifier);
      if (seenAt !== undefined && at - seenAt < window) {
        const seconds = Math.max(0, Math.round((at - seenAt) / 1000));
        decision = "review";
        reasons.push(
          `payment_identifier ${identifier} already produced a pay verdict ${seconds}s ago (window ${Math.round(window / 1000)}s) — a retried preflight is not a second approval`,
        );
      } else {
        approvedIdentifiers.set(identifier, at);
        // Prune inside the same call: an unbounded map is a memory leak with a security name.
        for (const [key, when] of approvedIdentifiers) {
          if (at - when >= window) approvedIdentifiers.delete(key);
        }
      }
    }
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
    ...(agent !== undefined ? { agent } : {}),
    selectedAccept,
    acceptResults,
    reasons,
    summary,
    dailyCapNote,
  };
}
