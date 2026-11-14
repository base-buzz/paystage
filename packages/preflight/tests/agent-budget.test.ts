import { describe, it, expect } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";
import { parsePolicy } from "@paystage/policy";

/**
 * Per-agent budgets existed in the evaluator and were unreachable: the hosted API accepted
 * `agent_id` but the MCP tool did not, and the verdict never said which agent it judged. These tests
 * pin both — a refusal that cannot name its agent is unreadable in a log with two agents in it.
 */

const TREASURY = "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const policy = parsePolicy({
  version: 1,
  max_amount: { value: "100", asset: "USDC", decimals: 6 },
  allowed_pay_to: [TREASURY],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
  agents: {
    cheap: { max_amount: { value: "1", asset: "USDC", decimals: 6 } },
    expensive: { max_amount: { value: "90", asset: "USDC", decimals: 6 } },
  },
} as never);

const pr = (atomic: string) => ({
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: atomic,
      asset: USDC,
      payTo: TREASURY,
      maxTimeoutSeconds: 300,
    },
  ],
}) as never;

describe("per-agent budgets", () => {
  it("judges the same payment differently for two agents", () => {
    const amount = "5000000"; // 5 USDC: over the cheap cap, under the expensive one
    expect(evaluatePayment(pr(amount), policy, { agentId: "cheap" }).decision).toBe("do_not_pay");
    expect(evaluatePayment(pr(amount), policy, { agentId: "expensive" }).decision).toBe("pay");
  });

  it("names the agent on the verdict", () => {
    expect(evaluatePayment(pr("5000000"), policy, { agentId: "cheap" }).agent).toBe("cheap");
  });

  it("omits the agent when none was supplied, rather than inventing one", () => {
    expect(evaluatePayment(pr("5000000"), policy).agent).toBeUndefined();
  });

  it("refuses an unknown agent and names it", () => {
    const result = evaluatePayment(pr("5000000"), policy, { agentId: "nobody" });
    expect(result.decision).toBe("do_not_pay");
    expect(result.agent).toBe("nobody");
    expect(result.reasons.join(" ")).toContain("nobody");
  });
});
