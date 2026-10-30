import { humanToAtomic } from "@paystage/policy";
import type { VelocityWindow } from "@paystage/policy";
import type {
  VelocityAction,
  VelocityResult,
  VelocityWindowResult,
} from "./types.js";

export interface CheckVelocityArgs {
  history: VelocityAction[];
  proposed: VelocityAction;
  windows: VelocityWindow[];
  now_ms?: number;
}

/**
 * Pure rolling-window velocity check (rate and spend-pattern).
 *
 * History actions with timestamp_ms strictly greater than
 * `now - window_seconds*1000` are included (boundary excluded), plus proposed.
 * Denies if count > max_count or aggregate atomic amount > max_amount.
 */
export function checkVelocity(args: CheckVelocityArgs): VelocityResult {
  const { history, proposed, windows } = args;
  const now = args.now_ms ?? Date.now();

  const reasons: string[] = [];
  const windows_checked: VelocityWindowResult[] = [];

  if (!windows.length) {
    return { decision: "allow", reasons: [], windows_checked: [] };
  }

  for (const window of windows) {
    const cutoff = now - window.window_seconds * 1000;

    let count = 0;
    let amount = 0n;

    for (const action of history) {
      if (action.timestamp_ms > cutoff) {
        count += 1;
        amount += action.amount_atomic;
      }
    }

    count += 1;
    amount += proposed.amount_atomic;

    const maxAmountAtomic =
      window.max_amount !== undefined
        ? humanToAtomic(window.max_amount.value, window.max_amount.decimals)
        : undefined;

    const countOk =
      window.max_count === undefined ? true : count <= window.max_count;
    const amountOk =
      maxAmountAtomic === undefined ? true : amount <= maxAmountAtomic;

    const passed = countOk && amountOk;

    if (!countOk) {
      reasons.push(
        `window ${window.window_seconds}s: count ${count} exceeds max_count ${window.max_count}`,
      );
    }
    if (!amountOk) {
      reasons.push(
        `window ${window.window_seconds}s: amount ${amount.toString()} exceeds max_amount ${maxAmountAtomic!.toString()}`,
      );
    }

    windows_checked.push({
      window_seconds: window.window_seconds,
      count,
      amount_atomic: amount,
      max_count: window.max_count,
      max_amount_atomic: maxAmountAtomic,
      count_ok: countOk,
      amount_ok: amountOk,
      passed,
    });
  }

  return {
    decision: reasons.length === 0 ? "allow" : "deny",
    reasons,
    windows_checked,
  };
}
