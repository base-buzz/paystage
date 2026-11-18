import { describe, expect, it } from "vitest";
import { checkVelocity } from "../src/check.js";

/**
 * #39 — a per-payee ceiling, because an aggregate one does not stop a single compromised seller address.
 *
 * The scenario that fails without this: every payment is small, spaced out, and under the daily ceiling, so nothing
 * fires — while one payee quietly collects the whole day's allowance.
 */

const NOW = 2_000_000_000_000;
const WINDOW = { window_seconds: 3600, per_payee_max_amount: { value: "1", decimals: 6 } };
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

const action = (payee: string, minutesAgo: number, atomic: number) => ({
  timestamp_ms: NOW - minutesAgo * 60_000,
  amount_atomic: BigInt(atomic),
  payee,
});

describe("per-payee velocity", () => {
  it("denies one payee that exceeds its own ceiling, even when the aggregate is fine", () => {
    const result = checkVelocity({
      history: [action(A, 30, 400_000), action(A, 20, 400_000), action(A, 10, 400_000)],
      proposed: { timestamp_ms: NOW, amount_atomic: 400_000n, payee: A },
      windows: [WINDOW],
      now_ms: NOW,
    });
    expect(result.decision).toBe("deny");
    expect(result.reasons.join(" ")).toMatch(/per_payee_max_amount/);
    expect(result.reasons.join(" ")).toContain(A);
  });

  it("allows the same spend when it is spread across payees", () => {
    const result = checkVelocity({
      history: [action(A, 30, 400_000), action(B, 20, 400_000), action(A, 10, 400_000)],
      proposed: { timestamp_ms: NOW, amount_atomic: 400_000n, payee: B },
      windows: [WINDOW],
      now_ms: NOW,
    });
    expect(result.decision).toBe("allow");
  });

  it("counts a payee case-insensitively", () => {
    const result = checkVelocity({
      history: [action(A.toUpperCase().replace("0X", "0x"), 10, 900_000)],
      proposed: { timestamp_ms: NOW, amount_atomic: 200_000n, payee: A },
      windows: [WINDOW],
      now_ms: NOW,
    });
    expect(result.decision).toBe("deny");
  });

  it("does not attribute a payment with no payee to anyone", () => {
    const result = checkVelocity({
      history: [{ timestamp_ms: NOW - 60_000, amount_atomic: 5_000_000n }],
      proposed: { timestamp_ms: NOW, amount_atomic: 200_000n, payee: A },
      windows: [WINDOW],
      now_ms: NOW,
    });
    // The proposed payment is inside its payee ceiling; the unattributed history is not counted against it.
    expect(result.decision).toBe("allow");
  });
});
