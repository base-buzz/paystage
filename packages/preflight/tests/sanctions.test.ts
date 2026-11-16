import { describe, it, expect } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";
import { SANCTIONED_ADDRESSES } from "../src/sanctioned-addresses.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const policy = (payee: string) => ({
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  allowed_pay_to: [payee],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
});

const challenge = (payee: string) => ({
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000", asset: USDC, payTo: payee, maxTimeoutSeconds: 300 }],
});

describe("OFAC sanctions screening", () => {
  it("ships a list of real sanctioned addresses", () => {
    expect(SANCTIONED_ADDRESSES.size).toBeGreaterThan(50);
  });

  it("refuses a sanctioned payee even when the policy allows it", () => {
    const sanctioned = [...SANCTIONED_ADDRESSES][0];
    const result = evaluatePayment(challenge(sanctioned) as never, policy(sanctioned) as never);
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.join(" ")).toMatch(/sanctioned address \(OFAC SDN\)/);
  });

  it("names the sanctions list rather than the drainer list, so the citation is checkable", () => {
    const sanctioned = [...SANCTIONED_ADDRESSES][1];
    const result = evaluatePayment(challenge(sanctioned) as never, policy(sanctioned) as never);
    expect(result.reasons.join(" ")).not.toMatch(/known drainer/);
  });
});
