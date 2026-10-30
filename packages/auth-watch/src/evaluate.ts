import type { Policy } from "@paystage/policy";
import type { AuthFlag, AuthItem, EvaluateAuthResult } from "./types.js";

const UNLIMITED_THRESHOLD = 2n ** 255n;

function normalize(addr: string): string {
  return addr.toLowerCase();
}

function isUnlimited(item: AuthItem): boolean {
  return item.amount >= UNLIMITED_THRESHOLD;
}

function isUnknownSpender(item: AuthItem, policy: Policy): boolean {
  const allowed = policy.allowed_spenders ?? policy.allowed_pay_to;
  const spender = normalize(item.spender);
  return !allowed.some((a) => normalize(a) === spender);
}

function isStale(item: AuthItem, nowSeconds: number): boolean {
  if (item.expirationSeconds === undefined) return false;
  if (item.expirationSeconds === 0) return false;
  return nowSeconds > item.expirationSeconds;
}

export function evaluateOutstandingAuths(
  items: AuthItem[],
  policy: Policy,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): EvaluateAuthResult[] {
  return items.map((item) => {
    const flags: AuthFlag[] = [];

    if (isUnlimited(item)) {
      flags.push("unlimited");
    }

    if (isUnknownSpender(item, policy)) {
      flags.push("unknown_spender");
    }

    if (isStale(item, nowSeconds)) {
      flags.push("stale");
    }

    let summary: EvaluateAuthResult["summary"] = "ok";
    if (flags.length > 0) {
      summary = "review";
    }

    const hasUnlimited = flags.includes("unlimited");
    const hasUnknown = flags.includes("unknown_spender");
    if (hasUnlimited || (hasUnknown && policy.unknown_payee === "deny")) {
      summary = "revoke_recommended";
    }

    return { item, flags, summary };
  });
}
