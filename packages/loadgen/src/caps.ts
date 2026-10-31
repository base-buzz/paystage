export const BUDGET_USD_TOTAL = 50;
export const DAILY_MAX_CALLS = 100;
export const MAX_DAYS = 30;
export const PRICE_PER_CALL_USD = 0.002;
export const FACILITATOR_PER_TX_USD = 0.001;
export const FACILITATOR_FREE_MONTHLY = 1000;
export const BASE_CALLS_PER_DAY = 20;
export const DAILY_GROWTH = 1.05;

export function dailyTarget(dayIndex: number): number {
  if (dayIndex < 0 || dayIndex >= MAX_DAYS) return 0;
  const raw = Math.floor(BASE_CALLS_PER_DAY * Math.pow(DAILY_GROWTH, dayIndex));
  return Math.min(raw, DAILY_MAX_CALLS);
}

export function projectedSpend(calls: number): number {
  const price = calls * PRICE_PER_CALL_USD;
  const facilitator =
    Math.max(0, calls - FACILITATOR_FREE_MONTHLY) * FACILITATOR_PER_TX_USD;
  return price + facilitator;
}

export function shouldStop(state: {
  totalCalls: number;
  totalSpendUsd: number;
  stoppedReason?: string | null;
}): { stop: boolean; reason?: string } {
  if (state.stoppedReason) return { stop: true, reason: state.stoppedReason };
  if (state.totalSpendUsd >= BUDGET_USD_TOTAL) return { stop: true, reason: "budget" };
  if (projectedSpend(state.totalCalls) >= BUDGET_USD_TOTAL) {
    return { stop: true, reason: "budget_projected" };
  }
  return { stop: false };
}
