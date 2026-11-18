import { describe, expect, it } from "vitest";
import { evaluateVelocity } from "../src/mcp.js";

/**
 * #39, through the tool's own input path: a policy field that parses, validates and then never fires is worse than one
 * that is rejected, because the operator believes they are protected.
 */

const NOW = 2_000_000_000_000;
const policy = {
  version: 1,
  max_amount: { value: "10", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x1111111111111111111111111111111111111111"],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 600,
  unknown_payee: "deny",
  velocity: { windows: [{ window_seconds: 3600, per_payee_max_amount: { value: "1", decimals: 6 } }] },
} as const;

const A = "0x1111111111111111111111111111111111111111";

describe("per-payee ceiling through the MCP input", () => {
  it("denies when one payee's total in the window passes its cap", async () => {
    const result = await evaluateVelocity({
      now_ms: NOW,
      history: [
        { timestamp_ms: NOW - 180_000, amount: "0.6", decimals: 6, payee: A },
        { timestamp_ms: NOW - 120_000, amount: "0.6", decimals: 6, payee: A },
      ],
      proposed: { timestamp_ms: NOW, amount: "0.6", decimals: 6, payee: A },
      policy,
    });
    expect(result.decision).toBe("deny");
    expect(result.reasons.join(" ")).toMatch(/per_payee_max_amount/);
  });
});
