import type {
  AssetCtx,
  AssetMeta,
  Decision,
  EvaluateTradeResult,
  Snapshot,
  TradeProposal,
} from "./types.js";
import type { TradePolicy } from "./policy.js";

const DECISION_RANK: Record<Decision, number> = {
  allow: 0,
  review: 1,
  do_not_trade: 2,
};

function worse(a: Decision, b: Decision): Decision {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

/**
 * Parse a decimal string to a JS number. Returns NaN on failure.
 * Uses Number() which is fine for the magnitudes involved here.
 */
function toNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return NaN;
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (trimmed === "") return NaN;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

function formatDecimal(n: number): string {
  if (!Number.isFinite(n)) return "NaN";
  // Avoid scientific notation for typical trade sizes.
  if (Math.abs(n) >= 1e-6 && Math.abs(n) < 1e21) {
    return n.toString();
  }
  return n.toExponential();
}

function findAssetIndex(
  universe: AssetMeta[],
  name: string,
): number {
  for (let i = 0; i < universe.length; i++) {
    if (universe[i]?.name === name) return i;
  }
  return -1;
}

function isDelisted(meta: AssetMeta): boolean {
  if (meta.isDelisted === true) return true;
  // Hyperliquid marks delisted assets with maxLeverage 0 in some cases.
  if (typeof meta.maxLeverage === "number" && meta.maxLeverage <= 0) {
    return true;
  }
  return false;
}

export function evaluateTrade(
  proposal: TradeProposal,
  snapshot: Snapshot,
  policy: TradePolicy,
): EvaluateTradeResult {
  const reasons: string[] = [];
  let decision: Decision = "allow";

  const bump = (d: Decision, reason: string): void => {
    decision = worse(decision, d);
    reasons.push(reason);
  };

  // 1. dex allowlist
  if (!policy.allowed_dexes.includes(proposal.dex)) {
    bump(
      "do_not_trade",
      `dex "${proposal.dex}" is not in allowed_dexes [${policy.allowed_dexes.join(", ")}]`,
    );
  }

  // 2. asset in universe / not delisted
  const idx = findAssetIndex(snapshot.meta.universe, proposal.asset);
  const assetMeta: AssetMeta | undefined =
    idx >= 0 ? snapshot.meta.universe[idx] : undefined;

  if (!assetMeta) {
    bump(
      policy.unknown_asset,
      `asset "${proposal.asset}" not found in ${snapshot.dex} universe`,
    );
  } else if (isDelisted(assetMeta)) {
    bump(
      policy.unknown_asset,
      `asset "${proposal.asset}" appears delisted (maxLeverage=${assetMeta.maxLeverage})`,
    );
  }

  // 3. asset allowlist
  if (!policy.allowed_assets.includes(proposal.asset)) {
    bump(
      policy.unknown_asset,
      `asset "${proposal.asset}" is not in allowed_assets`,
    );
  }

  // 4. leverage
  const leverage = proposal.leverage ?? 1;
  if (!Number.isFinite(leverage) || leverage <= 0) {
    bump("do_not_trade", `invalid leverage ${String(proposal.leverage)}`);
  } else {
    if (leverage > policy.max_leverage) {
      bump(
        "do_not_trade",
        `leverage ${leverage} exceeds policy max_leverage ${policy.max_leverage}`,
      );
    }
    if (assetMeta && typeof assetMeta.maxLeverage === "number") {
      if (leverage > assetMeta.maxLeverage) {
        bump(
          "do_not_trade",
          `leverage ${leverage} exceeds asset maxLeverage ${assetMeta.maxLeverage} for ${proposal.asset}`,
        );
      }
    }
  }

  // 5. notional
  const ctx: AssetCtx | undefined =
    idx >= 0 ? snapshot.assetCtxs[idx] : undefined;
  const markPxStr = ctx?.markPx;
  const markPx = toNumber(markPxStr);
  const size = toNumber(proposal.size);

  let notionalUsdc: number | undefined;

  if (!Number.isFinite(size) || size <= 0) {
    bump("do_not_trade", `invalid size "${proposal.size}"`);
  } else if (!Number.isFinite(markPx) || markPx <= 0) {
    bump(
      "do_not_trade",
      `missing or invalid markPx for ${proposal.asset} (got ${String(markPxStr)})`,
    );
  } else {
    notionalUsdc = size * markPx;
    const maxNotional = toNumber(policy.max_notional_usdc);
    if (!Number.isFinite(maxNotional)) {
      bump(
        "do_not_trade",
        `policy max_notional_usdc is not a valid number: "${policy.max_notional_usdc}"`,
      );
    } else if (notionalUsdc > maxNotional) {
      bump(
        "do_not_trade",
        `notional ${formatDecimal(notionalUsdc)} USDC exceeds max_notional_usdc ${policy.max_notional_usdc}`,
      );
    } else if (policy.require_review_above_notional_usdc !== undefined) {
      const reviewAbove = toNumber(policy.require_review_above_notional_usdc);
      if (!Number.isFinite(reviewAbove)) {
        bump(
          "do_not_trade",
          `policy require_review_above_notional_usdc is not a valid number: "${policy.require_review_above_notional_usdc}"`,
        );
      } else if (notionalUsdc > reviewAbove) {
        bump(
          "review",
          `notional ${formatDecimal(notionalUsdc)} USDC exceeds require_review_above_notional_usdc ${policy.require_review_above_notional_usdc}`,
        );
      }
    }
  }

  // 6. funding
  const fundingStr = ctx?.funding;
  const funding = toNumber(fundingStr);
  if (Number.isFinite(funding)) {
    const maxAbsFunding = toNumber(policy.max_abs_funding);
    if (!Number.isFinite(maxAbsFunding)) {
      bump(
        "do_not_trade",
        `policy max_abs_funding is not a valid number: "${policy.max_abs_funding}"`,
      );
    } else if (Math.abs(funding) > maxAbsFunding) {
      bump(
        "review",
        `|funding| ${formatDecimal(Math.abs(funding))} exceeds max_abs_funding ${policy.max_abs_funding}`,
      );
    }
  } else if (ctx) {
    // ctx exists but funding unparseable — fail closed to review.
    bump(
      "review",
      `funding for ${proposal.asset} is missing or invalid (got ${String(fundingStr)})`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("all checks passed");
  }

  const summary = buildSummary(
    decision,
    proposal,
    notionalUsdc,
    markPxStr,
    fundingStr,
  );

  const result: EvaluateTradeResult = {
    decision,
    reasons,
    summary,
  };

  if (assetMeta) result.asset = assetMeta.name;
  if (markPxStr !== undefined) result.markPx = markPxStr;
  if (notionalUsdc !== undefined) {
    result.notionalUsdc = formatDecimal(notionalUsdc);
  }
  if (fundingStr !== undefined) result.funding = fundingStr;

  return result;
}

function buildSummary(
  decision: Decision,
  proposal: TradeProposal,
  notionalUsdc: number | undefined,
  markPx: string | undefined,
  funding: string | undefined,
): string {
  const parts: string[] = [];
  parts.push(
    `${decision.toUpperCase()}: ${proposal.side} ${proposal.size} ${proposal.asset} on ${proposal.dex}`,
  );
  if (notionalUsdc !== undefined) {
    parts.push(`notional≈${formatDecimal(notionalUsdc)} USDC`);
  }
  if (markPx !== undefined) {
    parts.push(`markPx=${markPx}`);
  }
  if (funding !== undefined) {
    parts.push(`funding=${funding}`);
  }
  return parts.join(" | ");
}
