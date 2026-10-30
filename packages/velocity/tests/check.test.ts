import { describe, it, expect } from "vitest";
import { checkVelocity } from "../src/check.js";
import type { VelocityAction, VelocityWindow } from "../src/types.js";

const USDC = 1_000_000n; // 6 decimals

function action(
  timestamp_ms: number,
  amount_atomic: bigint,
  id?: string,
): VelocityAction {
  return { id, timestamp_ms, amount_atomic };
}

describe("checkVelocity", () => {
  it("allows empty history under limits", () => {
    const windows: VelocityWindow[] = [
      { window_seconds: 300, max_count: 5, max_amount: { value: "10.00", decimals: 6 } },
    ];
    const result = checkVelocity({
      history: [],
      proposed: action(1_000_000, 1n * USDC),
      windows,
      now_ms: 1_000_000,
    });
    expect(result.decision).toBe("allow");
    expect(result.reasons).toEqual([]);
    expect(result.windows_checked).toHaveLength(1);
    expect(result.windows_checked[0].count).toBe(1);
    expect(result.windows_checked[0].amount_atomic).toBe(1n * USDC);
  });

  it("excludes actions exactly at the window boundary (strictly greater than cutoff)", () => {
    const now = 10_000_000;
    const windowSeconds = 300;
    const cutoff = now - windowSeconds * 1000;

    const windows: VelocityWindow[] = [
      { window_seconds: windowSeconds, max_count: 1 },
    ];

    // History action exactly at cutoff should be excluded.
    const result = checkVelocity({
      history: [action(cutoff, 1n * USDC, "boundary")],
      proposed: action(now, 1n * USDC, "proposed"),
      windows,
      now_ms: now,
    });

    expect(result.decision).toBe("allow");
    expect(result.windows_checked[0].count).toBe(1); // only proposed
  });

  it("includes actions strictly inside the window", () => {
    const now = 10_000_000;
    const windowSeconds = 300;
    const cutoff = now - windowSeconds * 1000;

    const windows: VelocityWindow[] = [
      { window_seconds: windowSeconds, max_count: 1 },
    ];

    const result = checkVelocity({
      history: [action(cutoff + 1, 1n * USDC, "inside")],
      proposed: action(now, 1n * USDC, "proposed"),
      windows,
      now_ms: now,
    });

    expect(result.decision).toBe("deny");
    expect(result.windows_checked[0].count).toBe(2);
    expect(result.reasons[0]).toContain("count");
    expect(result.reasons[0]).toContain("300");
  });

  it("denies on aggregate amount breach in 5-minute window (burst)", () => {
    const now = 10_000_000;
    const windows: VelocityWindow[] = [
      {
        window_seconds: 300,
        max_count: 100,
        max_amount: { value: "10.00", decimals: 6 }, // 10 USDC
      },
    ];

    // 4 x 3 USDC = 12 USDC in window, each individually small.
    const history = [
      action(now - 1000, 3n * USDC, "a"),
      action(now - 2000, 3n * USDC, "b"),
      action(now - 3000, 3n * USDC, "c"),
    ];
    const proposed = action(now, 3n * USDC, "d");

    const result = checkVelocity({ history, proposed, windows, now_ms: now });

    expect(result.decision).toBe("deny");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("amount");
    expect(result.reasons[0]).toContain("300");
    expect(result.windows_checked[0].amount_atomic).toBe(12n * USDC);
    expect(result.windows_checked[0].count_ok).toBe(true);
    expect(result.windows_checked[0].amount_ok).toBe(false);
  });

  it("denies on max_count breach in 30-minute window", () => {
    const now = 10_000_000;
    const windows: VelocityWindow[] = [
      { window_seconds: 1800, max_count: 3 },
    ];

    const history = [
      action(now - 60_000, 1n * USDC, "a"),
      action(now - 120_000, 1n * USDC, "b"),
      action(now - 180_000, 1n * USDC, "c"),
    ];
    const proposed = action(now, 1n * USDC, "d");

    const result = checkVelocity({ history, proposed, windows, now_ms: now });

    expect(result.decision).toBe("deny");
    expect(result.reasons[0]).toContain("count");
    expect(result.reasons[0]).toContain("1800");
    expect(result.windows_checked[0].count).toBe(4);
    expect(result.windows_checked[0].count_ok).toBe(false);
  });

  it("handles large BigInt amounts without Number precision loss", () => {
    const now = 10_000_000;
    const big = 10n ** 18n; // 1e18 atomic units
    const windows: VelocityWindow[] = [
      {
        window_seconds: 300,
        max_amount: { value: "1000000000000000000", decimals: 0 },
      },
    ];

    // Exactly at limit: allow.
    const allowResult = checkVelocity({
      history: [],
      proposed: action(now, big),
      windows,
      now_ms: now,
    });
    expect(allowResult.decision).toBe("allow");
    expect(allowResult.windows_checked[0].amount_atomic).toBe(big);

    // One over: deny.
    const denyResult = checkVelocity({
      history: [],
      proposed: action(now, big + 1n),
      windows,
      now_ms: now,
    });
    expect(denyResult.decision).toBe("deny");
    expect(denyResult.windows_checked[0].amount_atomic).toBe(big + 1n);
  });

  it("reports only the breached window in reasons when multiple windows configured", () => {
    const now = 10_000_000;
    const windows: VelocityWindow[] = [
      { window_seconds: 300, max_count: 10, max_amount: { value: "100.00", decimals: 6 } },
      { window_seconds: 1800, max_count: 2 },
      { window_seconds: 18000, max_count: 100 },
    ];

    const history = [
      action(now - 60_000, 1n * USDC, "a"),
      action(now - 120_000, 1n * USDC, "b"),
    ];
    const proposed = action(now, 1n * USDC, "c");

    const result = checkVelocity({ history, proposed, windows, now_ms: now });

    expect(result.decision).toBe("deny");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("1800");
    expect(result.reasons[0]).toContain("count");

    const byWindow = new Map(
      result.windows_checked.map((w) => [w.window_seconds, w]),
    );
    expect(byWindow.get(300)!.passed).toBe(true);
    expect(byWindow.get(1800)!.passed).toBe(false);
    expect(byWindow.get(18000)!.passed).toBe(true);
  });

  it("allows when no windows configured", () => {
    const result = checkVelocity({
      history: [action(1, 1n)],
      proposed: action(2, 1n),
      windows: [],
      now_ms: 2,
    });
    expect(result.decision).toBe("allow");
    expect(result.windows_checked).toEqual([]);
  });
});
