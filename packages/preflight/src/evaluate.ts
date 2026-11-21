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
import {
  currentSvmPeer,
  isSolanaNetwork,
  SVM_PEER_ABSENT_DETAIL,
  SVM_PEER_PRESENT_DETAIL,
  SVM_WILDCARD,
  validateSolanaAccept,
  type SvmValidationPeer,
} from "./solana.js";

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

/**
 * One rule the evaluator actually executed, in the order it executed it.
 *
 * This is the evaluator's own transcript, not a reconstruction. A bundle that re-narrates a
 * verdict from the final reasons can describe a rule that never ran (the evaluator returns at
 * the first refusal); the only honest source for "what happened" is the code that decided.
 * `rule` is a stable identifier, `detail` is the evaluator's own sentence, and `accept_index`
 * ties a per-option step to the accept it judged.
 */
export type EvaluationStepOutcome = "pass" | "fail" | "review" | "skip" | "note";

export interface EvaluationStep {
  /** 1-based position in the transcript. */
  seq: number;
  rule: string;
  scope: "request" | "accept" | "result";
  outcome: EvaluationStepOutcome;
  detail: string;
  accept_index?: number;
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
  /**
   * The rules this call actually ran, in order. Present on every result, including the early
   * refusals, because an evidence bundle must be able to say why a request never reached rule 7.
   */
  steps: EvaluationStep[];
  dailyCapNote?: string;
  /**
   * The case a human is being asked to decide, present only on `review`.
   *
   * `pay` and `do_not_pay` already say what an agent can act on; a `review` says
   * "ask your human", and without this object it hands that human a verdict and
   * nothing else. The field names follow `docs/specs/review-packet/README.md`
   * where that study has them (`schema`, `amount`, `payee`, `decision`); the
   * study deliberately labels agent identity, request id, approval URL and
   * signature scope "proposed, no surface evidence", so they stay out rather
   * than being invented here.
   */
  packet?: ReviewPacket;
}

/**
 * A small, human-readable case for a `review`.
 *
 * Kept flat on purpose: amount and payee and rule are what a person reads first,
 * then the two lists that stop them over-trusting the verdict, then the single
 * question. The `rule` string is the evaluator's own reason text, not a second
 * vocabulary, so it can be matched against `reasons` and `acceptResults[].reasons`.
 */
export interface ReviewPacket {
  schema: "paystage.review-packet.v1";
  amount: {
    value: string;
    symbol: string;
    atomic: string;
    share: {
      /** Which policy ceiling the share is measured against; null when none applies. */
      of: "max_amount" | "require_human_above" | null;
      /** The denominator, named in the policy's own units; "unknown" when no cap applies. */
      denominator: string;
      /** amount / denominator as a percentage; "unknown" when there is no denominator. */
      ratio: string;
    };
  };
  payee: {
    address: string;
    network: string;
    asset: string;
    symbol: string;
    /** The `resource.url` host, when the challenge named one. */
    origin?: string;
  };
  rule: string;
  checked: string[];
  not_checked: string[];
  decision: {
    question: string;
    options: [string, string];
  };
}

export interface ReviewPacketOptions {
  /** Checks a host performed after the evaluator (for example network reputation). */
  checked?: string[];
  notChecked?: string[];
  /** Set when the host has already run the network checks, so they are not reported as skipped. */
  networkChecks?: boolean;
  /** Set when the evaluator's own verdict was `pay`, so every local rule did run before the host's extra check. */
  allRulesRan?: boolean;
  agentId?: string;
  paymentIdentifier?: string;
  /** Whether the replay check actually ran. False with an identifier means an earlier rule returned review. */
  paymentIdentifierChecked?: boolean;
}

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * `allowed_networks` entries are exact CAIP-2 ids, except `solana:*`, which is the wildcard
 * `@x402/svm` itself registers for v2 clients. An EVM entry always matches exactly.
 */
function networkMatches(allowed: string, actual: string): boolean {
  if (allowed === SVM_WILDCARD) return isSolanaNetwork(actual);
  return eq(allowed, actual);
}

/**
 * Solana base58 addresses are case-sensitive, so the EVM habit of lowercasing before comparing
 * would let two different mints or payees compare equal. EVM addresses keep their old,
 * case-insensitive behaviour.
 */
function addressEq(network: string, a: string, b: string): boolean {
  return isSolanaNetwork(network) ? a === b : eq(a, b);
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
      (a.network === undefined || networkMatches(a.network, network)) &&
      addressEq(network, a.address, assetAddress),
  );
}

type RecordStep = (step: Omit<EvaluationStep, "seq">) => void;

function evaluateAccept(
  accept: AcceptOption,
  policy: Policy,
  resource: PaymentResource | undefined,
  record: RecordStep,
  acceptIndex: number,
  svmPeer: SvmValidationPeer | null,
): AcceptResult {
  const reasons: string[] = [];
  const pass = (rule: string, detail: string): void => {
    record({ rule, scope: "accept", accept_index: acceptIndex, outcome: "pass", detail });
  };
  const skip = (rule: string, detail: string): void => {
    record({ rule, scope: "accept", accept_index: acceptIndex, outcome: "skip", detail });
  };
  const deny = (rule: string, detail: string): AcceptResult => {
    reasons.push(detail);
    record({ rule, scope: "accept", accept_index: acceptIndex, outcome: "fail", detail });
    return { accept, status: "do_not_pay", reasons };
  };
  const hold = (rule: string, detail: string): AcceptResult => {
    reasons.push(detail);
    record({ rule, scope: "accept", accept_index: acceptIndex, outcome: "review", detail });
    return { accept, status: "review", reasons };
  };

  // Rule 2: network allowlist
  const networkAllowed = policy.allowed_networks.some((n) =>
    networkMatches(n, accept.network),
  );
  if (!networkAllowed) {
    return deny(
      "accept.network",
      `network ${accept.network} not in allowed_networks`,
    );
  }
  pass("accept.network", `network ${accept.network} is in allowed_networks`);

  // Rule 2.5: SVM requirement assertions. These are the four checks @x402/svm makes on a
  // payment requirement before it builds a payload. They run before the policy asset lookup
  // so a malformed Solana address is reported as `solana.asset`, not as "not in allowed_assets".
  const solana = isSolanaNetwork(accept.network);
  if (solana) {
    if (svmPeer) {
      pass("solana.peer", SVM_PEER_PRESENT_DETAIL);
    } else {
      // An optional peer that is absent must not look like a check that passed. The
      // transcript says the built-in copy ran; the verdict still depends on all four rules.
      skip("solana.peer", SVM_PEER_ABSENT_DETAIL);
    }
    const svm = validateSolanaAccept(accept, svmPeer);
    for (const check of svm.assertions) pass(check.rule, check.detail);
    if (!svm.ok) return deny(svm.rule, svm.reason);
  }

  // Rule 3: asset must match allowed_assets with same network
  const asset = findAsset(policy, accept.network, accept.asset);
  if (!asset) {
    return deny(
      "accept.asset",
      `asset ${accept.asset} on ${accept.network} not in allowed_assets`,
    );
  }
  pass("accept.asset", `asset ${asset.symbol} at ${accept.asset} matched allowed_assets on ${accept.network}`);

  // Rule 4: amount is atomic
  let amount: bigint;
  try {
    amount = BigInt(accept.amount);
  } catch {
    return deny("accept.amount", `invalid atomic amount ${accept.amount}`);
  }
  pass("accept.amount", `atomic amount ${accept.amount} parsed`);

  // Rule 5: policy-level max_amount, only if asset symbol matches
  if (eq(policy.max_amount.asset, asset.symbol)) {
    // The ceiling is expressed in the unit of the asset this challenge actually matched —
    // NOT in `max_amount.decimals`. Those can disagree when a policy lists the same ticker
    // twice at different decimals, and a ceiling computed in one unit then compared against
    // an amount in another fails open: 400 tokens read as 0.04 against a 0.05 cap.
    // `max_amount.decimals` remains a parse-time cross-check; it must not define the unit.
    const maxAtomic = humanToAtomic(policy.max_amount.value, asset.decimals);
    if (amount > maxAtomic) {
      return deny(
        "accept.max_amount",
        `amount ${atomicToHuman(amount, asset.decimals)} ${asset.symbol} exceeds max_amount ${policy.max_amount.value} ${policy.max_amount.asset}`,
      );
    }
    pass(
      "accept.max_amount",
      `amount ${atomicToHuman(amount, asset.decimals)} ${asset.symbol} is at or under max_amount ${policy.max_amount.value} ${policy.max_amount.asset}`,
    );
  } else {
    skip(
      "accept.max_amount",
      `max_amount not applied: the policy ceiling is denominated in ${policy.max_amount.asset}, the challenge asset is ${asset.symbol}`,
    );
  }

  // Rule 6: timeout
  if (accept.maxTimeoutSeconds > policy.max_timeout_seconds) {
    return deny(
      "accept.timeout",
      `maxTimeoutSeconds ${accept.maxTimeoutSeconds} exceeds policy max_timeout_seconds ${policy.max_timeout_seconds}`,
    );
  }
  pass(
    "accept.timeout",
    `maxTimeoutSeconds ${accept.maxTimeoutSeconds} is within policy max_timeout_seconds ${policy.max_timeout_seconds}`,
  );

  if (!solana) {
    // Rule 1.5: the payee must be a 20-byte hex address.
    //
    // An external trading agent found this on our own example: `0x6160…3757e` has 41 hex characters, and the
    // evaluator answered `pay` because the string matched the allow-list as text. A malformed address is either a
    // typo or a swap, and money sent to it is unrecoverable — so it is a refusal with a named reason, not a match.
    if (!ADDRESS_RE.test(String(accept.payTo ?? ""))) {
      return deny(
        "accept.payee_shape",
        `invalid payTo address: expected 0x plus 40 hex characters, got ${String(accept.payTo ?? "").length - 2}`,
      );
    }
    pass("accept.payee_shape", `payTo ${accept.payTo} is a 20-byte hex address`);

    // Rule 7a: known drainers — hard deny before unknown_payee review
    if (isKnownDrainer(accept.payTo)) {
      return deny("accept.known_drainer", "known drainer");
    }
    pass("accept.known_drainer", "payee is not on the known-drainer list");

    // Rule 7a2: non-receivable sinks. Separate from the drainer list because the fact is different — paying
    // 0x…dEaD destroys the funds, nobody steals them. Same verdict, truthful reason, and the published drainer
    // list stops claiming a burn address is a thief.
    if (isNonReceivable(accept.payTo)) {
      return deny(
        "accept.non_receivable",
        `non-receivable payee ${accept.payTo} (funds are destroyed, not received)`,
      );
    }
    pass("accept.non_receivable", "payee is not on the non-receivable list");

    // Rule 7b: OFAC sanctions. Separate from the drainer list because the reason for refusing is different —
    // a drainer takes your funds, a sanctioned address may make paying *you* the violation. Both are hard
    // denies, and the reason code says which list fired so a human can check the citation.
    if (SANCTIONED_ADDRESSES.has(String(accept.payTo).toLowerCase())) {
      return deny("accept.sanctions", "sanctioned address (OFAC SDN)");
    }
    pass("accept.sanctions", "payee is not on the OFAC SDN list");
  } else {
    // The drainer and sanctions lists hold EVM addresses. Saying "no match" for a Solana payee
    // would claim a check that cannot see this chain, so the transcript records the skip.
    skip(
      "accept.known_drainer",
      "the known-drainer list holds EVM addresses; it was not applied to this Solana payee",
    );
    skip(
      "accept.non_receivable",
      "the non-receivable list holds EVM addresses; it was not applied to this Solana payee",
    );
    skip(
      "accept.sanctions",
      "the OFAC SDN list in this package holds EVM addresses; it was not applied to this Solana payee",
    );
  }

  // Rule 7: payee allowlist
  const payeeAllowed = policy.allowed_pay_to.some((p) =>
    addressEq(accept.network, p, accept.payTo),
  );
  if (!payeeAllowed) {
    if (policy.unknown_payee === "deny") {
      return deny(
        "accept.payee_allowlist",
        `payTo ${accept.payTo} not in allowed_pay_to (deny)`,
      );
    }
    return hold(
      "accept.payee_allowlist",
      `payTo ${accept.payTo} not in allowed_pay_to (review)`,
    );
  }
  pass("accept.payee_allowlist", `payTo ${accept.payTo} is in allowed_pay_to`);

  /**
   * Rule 7c: the payee matches the host's verified record, when we have one (#133 → #164).
   *
   * A challenge names both `resource` and `payTo`, and nothing ties them together: an endpoint can put any host in `resource` and
   * ask to be paid at an address it controls. When that host is one we have probed, a different payee is a fact worth stopping
   * for — `review`, not `do_not_pay`, because a provider may legitimately rotate its payee and refusing on rotation would punish
   * the honest case this registry exists to protect.
   */
  if (solana) {
    // The registry's records are EVM addresses. Comparing a base58 payee to one would produce a
    // `review` for every Solana payment, which is a false positive dressed as a safety check.
    skip(
      "accept.verified_payee",
      "the verified-payee registry holds EVM addresses; it was not compared to this Solana payee",
    );
  } else if (resource?.url) {
    let host: string | undefined;
    try {
      host = new URL(resource.url).host.toLowerCase();
    } catch {
      host = undefined;
    }
    if (host === undefined) {
      skip("accept.verified_payee", "resource.url is not a parseable URL, so there is no host to compare the payee against");
    } else {
      const verified = verifiedPayeeFor(host);
      if (verified && verified.payee !== String(accept.payTo).toLowerCase()) {
        return hold(
          "accept.verified_payee",
          `payTo ${accept.payTo} differs from the verified address for ${verified.host} (${verified.payee}, verified ${verified.verified_at ?? "undated"}) — the endpoint may be a clone, or the provider rotated its payee`,
        );
      }
      if (verified) {
        pass("accept.verified_payee", `payTo ${accept.payTo} matches the verified address for ${verified.host}`);
      } else {
        skip("accept.verified_payee", `no verified-payee record for ${host}`);
      }
    }
  } else {
    skip("accept.verified_payee", "the challenge has no resource.url, so there is no host to compare the payee against");
  }

  // Rule 8: require_human_above
  if (policy.require_human_above) {
    const threshold = humanToAtomic(
      policy.require_human_above.value,
      policy.require_human_above.decimals,
    );
    if (amount > threshold) {
      return hold(
        "accept.require_human_above",
        `amount ${atomicToHuman(amount, asset.decimals)} ${asset.symbol} exceeds require_human_above ${policy.require_human_above.value} ${policy.require_human_above.asset}`,
      );
    }
    pass(
      "accept.require_human_above",
      `amount ${atomicToHuman(amount, asset.decimals)} ${asset.symbol} is at or under require_human_above ${policy.require_human_above.value} ${policy.require_human_above.asset}`,
    );
  } else {
    skip("accept.require_human_above", "no require_human_above configured, so no human threshold applied");
  }

  pass("accept.result", "all accept rules allowed this option");
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

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Rounded to two decimal places, without scientific notation and without a trailing `.00`. */
function percentOf(amount: bigint, cap: bigint): string {
  if (cap <= 0n) return "unknown";
  const basisPoints = (amount * 10000n + cap / 2n) / cap;
  const whole = basisPoints / 100n;
  const fraction = basisPoints % 100n;
  if (fraction === 0n) return `${whole}%`;
  return `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}%`;
}

/**
 * The amount's share of the ceiling that actually applies to this challenge.
 *
 * `max_amount` and `require_human_above` are the two ceilings the evaluator
 * enforces with this asset; `daily_cap` is informational and is reported as not
 * checked in the packet rather than used to imply a remaining budget we do not
 * track. When the policy's `max_amount` is denominated in a different asset, the
 * evaluator skips it (rule 5), so the honest denominator is "unknown", not a
 * number computed in the wrong unit.
 */
function shareOfCap(
  policy: Policy,
  asset: Asset | undefined,
  amount: bigint,
  reason: string,
): ReviewPacket["amount"]["share"] {
  const symbol = asset?.symbol ?? policy.max_amount.asset;
  const decimals = asset?.decimals ?? policy.max_amount.decimals;
  const maxApplies = eq(policy.max_amount.asset, symbol);
  const requireFired = policy.require_human_above !== undefined && reason.includes("require_human_above");

  if (requireFired && policy.require_human_above) {
    const cap = policy.require_human_above;
    return {
      of: "require_human_above",
      denominator: `${cap.value} ${cap.asset}`,
      ratio: percentOf(amount, humanToAtomic(cap.value, cap.decimals)),
    };
  }
  if (maxApplies) {
    return {
      of: "max_amount",
      denominator: `${policy.max_amount.value} ${policy.max_amount.asset}`,
      ratio: percentOf(amount, humanToAtomic(policy.max_amount.value, decimals)),
    };
  }
  return { of: null, denominator: "unknown", ratio: "unknown" };
}

/**
 * Build the case for a human from the same policy and accept the verdict was
 * computed from. Exported so a host that turns a `pay` into a `review` after an
 * extra check (the hosted API's reputation feed) can produce the same object
 * rather than a second, drifting packet.
 */
export function buildReviewPacket(
  policy: Policy,
  accept: AcceptOption,
  resource: PaymentResource | undefined,
  reason: string,
  options: ReviewPacketOptions = {},
): ReviewPacket {
  const asset = findAsset(policy, accept.network, accept.asset);
  const decimals = asset?.decimals ?? policy.max_amount.decimals;
  const symbol = asset?.symbol ?? policy.max_amount.asset;
  const amount = amountOf(accept);
  const human = atomicToHuman(amount, decimals);
  const origin = hostOf(resource?.url);
  const checked: string[] = [];
  const notChecked: string[] = [];

  // The evaluator returns at the first review rule, so a rule after the one that
  // fired did not run. Say so rather than reporting a check the verdict never
  // reached — the point of this list is to stop a person over-trusting it.
  const unknownPayeeReview = reason.includes("not in allowed_pay_to");
  const verifiedPayeeReview = reason.includes("differs from the verified address");
  const requireHumanReview = reason.includes("require_human_above");
  const replayReview = reason.includes("payment_identifier");
  const reachedVerifiedPayee = options.allRulesRan === true || verifiedPayeeReview || requireHumanReview || replayReview;
  const reachedRequireHuman = options.allRulesRan === true || requireHumanReview || replayReview;

  checked.push(`network: ${accept.network} is in allowed_networks`);
  checked.push(`asset: ${symbol} at ${accept.asset} matched allowed_assets`);
  checked.push(`amount: ${human} ${symbol} (${accept.amount} atomic) parsed and compared`);
  if (eq(policy.max_amount.asset, symbol)) {
    checked.push(`max_amount: ${human} ${symbol} is at or under ${policy.max_amount.value} ${policy.max_amount.asset}`);
  } else {
    notChecked.push(
      `max_amount: not applied — the policy ceiling is denominated in ${policy.max_amount.asset}, the challenge asset is ${symbol}`,
    );
  }
  checked.push(`timeout: ${accept.maxTimeoutSeconds}s is within max_timeout_seconds ${policy.max_timeout_seconds}`);
  const solana = isSolanaNetwork(accept.network);
  const payeeAllowed = policy.allowed_pay_to.some((p) =>
    addressEq(accept.network, p, accept.payTo),
  );
  if (solana) {
    checked.push(`SVM network: ${accept.network} is one of the three CAIP-2 networks @x402/svm accepts`);
    checked.push(`SVM asset: ${accept.asset} is a 32-byte base58 address (mint shape; existence and token program not checked)`);
    checked.push(`SVM payee: ${accept.payTo} is a 32-byte base58 address`);
    checked.push(`SVM amount: ${accept.amount} is an unsigned integer inside the SPL Token u64 range`);
    notChecked.push(
      "known-drainer, non-receivable and OFAC SDN lists: these lists hold EVM addresses, so they were not applied to this Solana payee",
    );
    notChecked.push(
      "mint existence and token program: not checked — the evaluator makes no RPC calls; @x402/svm reads the mint account before signing",
    );
    notChecked.push(
      "fee payer, compute budget, fee-payer isolation, inner transfers and smart-wallet limits: not checked — @x402/svm verifies these against a signed transaction, and a payment challenge contains none",
    );
    notChecked.push(
      "payee-vs-host verification: skipped — the verified-payee registry holds EVM addresses",
    );
    checked.push(
      payeeAllowed
        ? "payee allowlist: matched"
        : `payee allowlist: no match (unknown_payee=${policy.unknown_payee})`,
    );
  } else {
    checked.push(`payee shape: ${accept.payTo} is a 20-byte hex address`);
    checked.push("known-drainer, non-receivable and OFAC SDN lists: no match");
    checked.push(
      payeeAllowed
        ? "payee allowlist: matched"
        : `payee allowlist: no match (unknown_payee=${policy.unknown_payee})`,
    );

    if (origin) {
      if (reachedVerifiedPayee) {
        const verified = verifiedPayeeFor(origin);
        if (verified) {
          checked.push(`verified-payee registry: ${origin} is verified at ${verified.payee}`);
        } else {
          notChecked.push(`payee-vs-host verification: skipped — no verified record for ${origin}`);
        }
      } else {
        notChecked.push(
          `payee-vs-host verification: skipped — ${unknownPayeeReview ? "the payee allowlist" : "an earlier rule"} returned review before the registry was consulted`,
        );
      }
    } else {
      notChecked.push(
        "payee-vs-host verification: skipped — the challenge has no resource.url, so there is no host to compare the payee against",
      );
    }
  }

  if (policy.require_human_above && reachedRequireHuman) {
    const threshold = humanToAtomic(policy.require_human_above.value, policy.require_human_above.decimals);
    checked.push(
      `require_human_above: ${amount > threshold ? "crossed" : "not crossed"} at ${policy.require_human_above.value} ${policy.require_human_above.asset}`,
    );
  } else if (policy.require_human_above) {
    notChecked.push(
      "require_human_above: skipped — an earlier payee rule returned review before the amount threshold was reached",
    );
  } else {
    notChecked.push("require_human_above: not configured — no amount above which a human is required");
  }

  if (policy.agents) {
    checked.push(`agent budget: ${options.agentId ? `applied for ${options.agentId}` : "per-agent overlay applied"}`);
  } else {
    notChecked.push("per-agent budget: not configured — the global policy applied");
  }

  const window = (policy as { time_window?: unknown }).time_window;
  if (window) {
    checked.push("time window: checked against the policy's allowed/blocked UTC hours");
  } else {
    notChecked.push("time window: skipped — no time_window configured, so the hour was not a factor");
  }

  if (options.paymentIdentifier) {
    if (options.paymentIdentifierChecked) {
      checked.push(
        `payment-identifier replay: ${replayReview ? "duplicate detected" : "first use of this id"}`,
      );
    } else {
      notChecked.push(
        "payment-identifier replay: skipped — an earlier rule returned review before the identifier was compared",
      );
    }
  } else {
    notChecked.push("payment-identifier replay: skipped — no payment_identifier supplied");
  }

  if (policy.daily_cap) {
    notChecked.push(
      `daily budget remaining: not checked — daily_cap ${policy.daily_cap.value} ${policy.daily_cap.asset} is informational and the evaluator keeps no cross-call history`,
    );
  } else {
    notChecked.push("daily budget remaining: unknown — the policy declares no daily_cap");
  }

  if (!options.networkChecks) {
    notChecked.push(
      "seller reputation and address-risk feed: not checked — the local evaluator makes no network calls",
    );
  }
  notChecked.push("transfer simulation: not checked — the evaluator does not simulate the transfer or its balance changes");
  notChecked.push(
    "agent identity, request id, approval URL and signature scope: omitted — proposed, no surface evidence in the review-packet study",
  );

  checked.push(...(options.checked ?? []));
  notChecked.push(...(options.notChecked ?? []));

  return {
    schema: "paystage.review-packet.v1",
    amount: {
      value: human,
      symbol,
      atomic: accept.amount,
      share: shareOfCap(policy, asset, amount, reason),
    },
    payee: {
      address: accept.payTo,
      network: accept.network,
      asset: accept.asset,
      symbol,
      ...(origin ? { origin } : {}),
    },
    rule: reason,
    checked,
    not_checked: notChecked,
    decision: {
      question: `Pay ${human} ${symbol} to ${accept.payTo} on ${accept.network}?`,
      options: ["pay", "do_not_pay"],
    },
  };
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
  /**
   * The optional `@x402/svm` exports, when the host has loaded them.
   *
   * `undefined` uses whatever `loadSvmPeer()` found (the built-in copy when absent); `null`
   * explicitly models an absent peer. An injected peer must expose the same two helpers.
   */
  svmPeer?: SvmValidationPeer | null;
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
  const steps: EvaluationStep[] = [];
  const record: RecordStep = (step) => {
    steps.push({ seq: steps.length + 1, ...step });
  };

  // Rule 0: per-agent budgets. Resolve first — every later rule must run against the
  // narrowed policy, not the global one, or a cheap agent could be judged by the
  // expensive agent's ceiling.
  const resolution = resolveAgentPolicy(policy, options.agentId);
  if (!resolution.ok) {
    record({
      rule: "agent.resolve",
      scope: "request",
      outcome: "fail",
      detail: resolution.reason,
    });
    return {
      decision: "do_not_pay",
      acceptResults: [],
      reasons: [resolution.reason],
      summary: "Agent identity could not be resolved against the policy.",
      steps,
      ...(options.agentId !== undefined ? { agent: options.agentId } : {}),
    };
  }
  const effective = resolution.policy;
  const agent = options.agentId;
  record({
    rule: "agent.resolve",
    scope: "request",
    outcome: "pass",
    detail:
      agent !== undefined
        ? `agent ${agent} resolved to its narrowed policy`
        : "global policy applied (no per-agent overlay)",
  });
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
      record({
        rule: "request.time_window",
        scope: "request",
        outcome: "fail",
        detail: `outside allowed hours: policy permits ${pad(startH)}:00–${pad(endH)}:00 UTC, now ${pad(hour)}:00 UTC`,
      });
      return {
        decision: "do_not_pay",
        acceptResults: [],
        reasons: [`outside allowed hours: policy permits ${pad(startH)}:00–${pad(endH)}:00 UTC, now ${pad(hour)}:00 UTC`],
        summary: "Payment refused: outside the policy's time window.",
        steps,
      };
    }
    record({
      rule: "request.time_window",
      scope: "request",
      outcome: "pass",
      detail: `hour ${String(hour).padStart(2, "0")}:00 UTC is inside the policy's time window`,
    });
  } else {
    record({
      rule: "request.time_window",
      scope: "request",
      outcome: "skip",
      detail: "no time_window configured, so the hour was not a factor",
    });
  }

  // Rule 1: malformed
  if (!pr || pr.x402Version !== 2) {
    record({
      rule: "request.version",
      scope: "request",
      outcome: "fail",
      detail: `unsupported x402Version ${pr?.x402Version}`,
    });
    return {
      decision: "do_not_pay",
      acceptResults: [],
      reasons: [`unsupported x402Version ${pr?.x402Version}`],
      summary: "Payment request is malformed or unsupported version.",
      steps,
    };
  }
  record({
    rule: "request.version",
    scope: "request",
    outcome: "pass",
    detail: "x402Version is 2",
  });
  if (!Array.isArray(pr.accepts) || pr.accepts.length === 0) {
    record({
      rule: "request.accepts",
      scope: "request",
      outcome: "fail",
      detail: "no accepts in payment request",
    });
    return {
      decision: "do_not_pay",
      acceptResults: [],
      reasons: ["no accepts in payment request"],
      summary: "Payment request has no acceptable payment options.",
      steps,
    };
  }
  record({
    rule: "request.accepts",
    scope: "request",
    outcome: "pass",
    detail: `${pr.accepts.length} accept option(s) to evaluate`,
  });

  const svmPeer =
    options.svmPeer === undefined ? currentSvmPeer() : options.svmPeer;
  const acceptResults = pr.accepts.map((a, index) =>
    evaluateAccept(a, effective, pr.resource, record, index, svmPeer),
  );

  const payAccepts = acceptResults
    .filter((r) => r.status === "pay")
    .map((r) => r.accept);
  const reviewAccepts = acceptResults
    .filter((r) => r.status === "review")
    .map((r) => r.accept);

  let decision: Decision;
  let selectedAccept: AcceptOption | undefined;
  /** The exact evaluator reason that made this a review; it becomes `packet.rule`. */
  let reviewReason: string | undefined;
  if (payAccepts.length > 0) {
    decision = "pay";
    selectedAccept = cheapest(payAccepts);
  } else if (reviewAccepts.length > 0) {
    decision = "review";
    selectedAccept = cheapest(reviewAccepts);
    reviewReason = acceptResults.find((r) => r.accept === selectedAccept)?.reasons[0];
  } else {
    decision = "do_not_pay";
  }
  const selectedIndex = selectedAccept
    ? acceptResults.findIndex((r) => r.accept === selectedAccept)
    : -1;
  record({
    rule: "result.select",
    scope: "result",
    outcome: "note",
    detail:
      selectedIndex >= 0
        ? `accept #${selectedIndex} selected from the ${decision === "pay" ? "pay" : "review"}-tier options (cheapest first)`
        : "no accept option reached pay or review",
  });

  const reasons: string[] = [];
  for (const r of acceptResults) {
    for (const reason of r.reasons) reasons.push(reason);
  }

  // Rule 9: daily_cap note only
  let dailyCapNote: string | undefined;
  if (policy.daily_cap) {
    dailyCapNote = `daily_cap ${policy.daily_cap.value} ${policy.daily_cap.asset} (informational only)`;
    record({
      rule: "result.daily_cap",
      scope: "result",
      outcome: "skip",
      detail: `${dailyCapNote}; the evaluator keeps no cross-call history`,
    });
  } else {
    record({
      rule: "result.daily_cap",
      scope: "result",
      outcome: "skip",
      detail: "no daily_cap declared; remaining daily budget is unknown",
    });
  }

  /**
   * Rule 11.5: a retried preflight is not a second approval.
   *
   * Only a `pay` is downgraded: repeating a refusal or a review changes nothing, and those verdicts are the ones an agent should be free to re-ask. The identifier is checked *before*
   * the summary is written so the human-readable line and the decision cannot disagree.
   */
  const identifier = options.paymentIdentifier?.trim();
  let replayChecked = false;
  if (identifier && decision === "pay") {
    replayChecked = true;
    if (identifier.length > 128) {
      decision = "review";
      reviewReason = `payment_identifier is ${identifier.length} characters — refusing to cache a value that long; ask again with a stable, short id`;
      reasons.push(reviewReason);
      record({
        rule: "result.payment_identifier",
        scope: "result",
        outcome: "review",
        detail: reviewReason,
      });
    } else {
      const at = (options.now ?? new Date()).getTime();
      const window = options.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
      const seenAt = approvedIdentifiers.get(identifier);
      if (seenAt !== undefined && at - seenAt < window) {
        const seconds = Math.max(0, Math.round((at - seenAt) / 1000));
        decision = "review";
        reviewReason = `payment_identifier ${identifier} already produced a pay verdict ${seconds}s ago (window ${Math.round(window / 1000)}s) — a retried preflight is not a second approval`;
        reasons.push(reviewReason);
        record({
          rule: "result.payment_identifier",
          scope: "result",
          outcome: "review",
          detail: reviewReason,
        });
      } else {
        record({
          rule: "result.payment_identifier",
          scope: "result",
          outcome: "pass",
          detail: `first use of payment_identifier ${identifier} inside the ${Math.round(window / 1000)}s window`,
        });
        approvedIdentifiers.set(identifier, at);
        // Prune inside the same call: an unbounded map is a memory leak with a security name.
        for (const [key, when] of approvedIdentifiers) {
          if (at - when >= window) approvedIdentifiers.delete(key);
        }
      }
    }
  } else if (identifier) {
    record({
      rule: "result.payment_identifier",
      scope: "result",
      outcome: "skip",
      detail: `payment_identifier ${identifier} was not compared because the verdict was already ${decision}`,
    });
  } else {
    record({
      rule: "result.payment_identifier",
      scope: "result",
      outcome: "skip",
      detail: "no payment_identifier supplied",
    });
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
  record({
    rule: "result.verdict",
    scope: "result",
    outcome: decision === "pay" ? "pass" : decision === "review" ? "review" : "fail",
    detail: summary,
  });

  // Rule 13: the case for a human, on `review` only. A `pay` is for the agent and a
  // `do_not_pay` already carries the reasons it was refused; neither needs a packet,
  // and attaching one would make the three verdicts look interchangeable.
  const packet =
    decision === "review" && selectedAccept
      ? buildReviewPacket(
          effective,
          selectedAccept,
          pr.resource,
          reviewReason ?? reasons[0] ?? "review",
          {
            ...(agent !== undefined ? { agentId: agent } : {}),
            ...(identifier !== undefined ? { paymentIdentifier: identifier } : {}),
            paymentIdentifierChecked: replayChecked,
          },
        )
      : undefined;

  return {
    decision,
    ...(agent !== undefined ? { agent } : {}),
    selectedAccept,
    acceptResults,
    reasons,
    summary,
    steps,
    dailyCapNote,
    ...(packet ? { packet } : {}),
  };
}
