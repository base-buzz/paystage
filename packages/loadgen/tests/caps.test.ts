import { describe, it, expect } from "vitest";
import {
  dailyTarget,
  projectedSpend,
  shouldStop,
  DAILY_MAX_CALLS,
  MAX_DAYS,
  BUDGET_USD_TOTAL,
} from "../src/caps";
import { dayIndexFromStart, callsRemainingToday } from "../src/schedule";
import { pickScenario } from "../src/scenarios";

describe("dailyTarget", () => {
  it("starts at 20 on day 0", () => {
    expect(dailyTarget(0)).toBe(20);
  });
  it("compounds +5%/day and respects DAILY_MAX", () => {
    expect(dailyTarget(1)).toBe(21);
    expect(dailyTarget(10)).toBe(Math.min(Math.floor(20 * 1.05 ** 10), DAILY_MAX_CALLS));
    expect(dailyTarget(29)).toBeLessThanOrEqual(DAILY_MAX_CALLS);
  });
  it("is zero outside 0..29", () => {
    expect(dailyTarget(-1)).toBe(0);
    expect(dailyTarget(MAX_DAYS)).toBe(0);
  });
});

describe("projectedSpend + shouldStop", () => {
  it("estimates protocol + facilitator after free tier", () => {
    expect(projectedSpend(100)).toBeCloseTo(0.2);
    expect(projectedSpend(1000)).toBeCloseTo(2.0);
    expect(projectedSpend(1001)).toBeCloseTo(2.002 + 0.001);
  });
  it("stops at budget", () => {
    expect(shouldStop({ totalCalls: 0, totalSpendUsd: BUDGET_USD_TOTAL }).stop).toBe(true);
    expect(shouldStop({ totalCalls: 0, totalSpendUsd: 0 }).stop).toBe(false);
  });
});

describe("schedule", () => {
  it("computes day index from UTC start", () => {
    expect(dayIndexFromStart("2026-11-01", new Date("2026-11-01T12:00:00Z"))).toBe(0);
    expect(dayIndexFromStart("2026-11-01", new Date("2026-11-02T00:00:00Z"))).toBe(1);
  });
  it("remaining today", () => {
    expect(callsRemainingToday({ callsToday: 5 }, 20)).toBe(15);
    expect(callsRemainingToday({ callsToday: 20 }, 20)).toBe(0);
  });
});

describe("scenarios", () => {
  it("mixes allow / policy / velocity", () => {
    expect(pickScenario(() => 0.1)).toBe("allow");
    expect(pickScenario(() => 0.6)).toBe("policy_block");
    expect(pickScenario(() => 0.9)).toBe("velocity_deny");
  });
});
