import { describe, it, expect } from "vitest";
import { evaluateVelocity, serializeVelocityResult } from "../src/mcp.js";

const policy = {
  version: 1,
  max_amount: { value: "10.00", decimals: 6 },
  allowed_pay_to: ["0xabc"],
  allowed_assets: ["USDC"],
  allowed_networks: ["base"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
  velocity: {
    windows: [
      { window_seconds: 300, max_count: 3, max_amount: { value: "5.00", decimals: 6 } },
    ],
  },
};

describe("evaluateVelocity (MCP helper)", () => {
  it("accepts amount_atomic strings", async () => {
    const result = await evaluateVelocity({
      history: [],
      proposed: { timestamp_ms: 1_000_000, amount_atomic: "1000000" },
      policy,
      now_ms: 1_000_000,
    });
    expect(result.decision).toBe("allow");
  });

  it("accepts human amount + decimals", async () => {
    const result = await evaluateVelocity({
      history: [],
      proposed: { timestamp_ms: 1_000_000, amount: "1.50", decimals: 6 },
      policy,
      now_ms: 1_000_000,
    });
    expect(result.decision).toBe("allow");
    expect(result.windows_checked[0].amount_atomic).toBe(1_500_000n);
  });

  it("denies when aggregate exceeds window max_amount", async () => {
    const result = await evaluateVelocity({
      history: [
        { timestamp_ms: 999_000, amount_atomic: "2000000" },
        { timestamp_ms: 998_000, amount_atomic: "2000000" },
      ],
      proposed: { timestamp_ms: 1_000_000, amount_atomic: "2000000" },
      policy,
      now_ms: 1_000_000,
    });
    expect(result.decision).toBe("deny");
    expect(result.reasons[0]).toContain("amount");
  });

  it("serializes BigInt fields to strings", async () => {
    const result = await evaluateVelocity({
      history: [],
      proposed: { timestamp_ms: 1_000_000, amount_atomic: "1000000" },
      policy,
      now_ms: 1_000_000,
    });
    const json = serializeVelocityResult(result) as {
      windows_checked: Array<{ amount_atomic: string }>;
    };
    expect(typeof json.windows_checked[0].amount_atomic).toBe("string");
  });

  it("allows when policy has no velocity field", async () => {
    const result = await evaluateVelocity({
      history: [],
      proposed: { timestamp_ms: 1_000_000, amount_atomic: "1000000" },
      policy: { ...policy, velocity: undefined },
      now_ms: 1_000_000,
    });
    expect(result.decision).toBe("allow");
    expect(result.windows_checked).toEqual([]);
  });
});
