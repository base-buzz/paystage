import { describe, it, expect } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";
import { normalizePaymentRequired } from "../src/normalize.js";
import type { Policy } from "../src/policy.js";
import {
  baseMainnetSmall,
  baseSepoliaSmall,
  baseMainnetNearHuman,
  mcpWrapped,
  wrongNetwork,
  unknownAsset,
  overMax,
  timeoutTooLong,
  emptyAccepts,
  wrongVersion,
  addressCaseFriendly,
} from "./fixtures/x402-payloads.js";

const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
    { symbol: "USDC", decimals: 6, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", network: "eip155:84532" },
  ],
  allowed_networks: ["eip155:8453", "eip155:84532"],
  max_timeout_seconds: 300,
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "review",
};

describe("x402 payload fixtures", () => {
  it("pays base mainnet small", () => {
    expect(evaluatePayment(baseMainnetSmall, policy).decision).toBe("pay");
  });

  it("pays base sepolia small", () => {
    expect(evaluatePayment(baseSepoliaSmall, policy).decision).toBe("pay");
  });

  it("reviews base mainnet near human threshold", () => {
    expect(evaluatePayment(baseMainnetNearHuman, policy).decision).toBe("review");
  });

  it("pays mcp wrapped payload", () => {
    expect(evaluatePayment(normalizePaymentRequired(mcpWrapped), policy).decision).toBe("pay");
  });

  it("pays address case friendly payload", () => {
    expect(evaluatePayment(addressCaseFriendly, policy).decision).toBe("pay");
  });

  it("does not pay wrong network", () => {
    expect(evaluatePayment(wrongNetwork, policy).decision).toBe("do_not_pay");
  });

  it("does not pay unknown asset", () => {
    expect(evaluatePayment(unknownAsset, policy).decision).toBe("do_not_pay");
  });

  it("does not pay over max", () => {
    expect(evaluatePayment(overMax, policy).decision).toBe("do_not_pay");
  });

  it("does not pay timeout too long", () => {
    expect(evaluatePayment(timeoutTooLong, policy).decision).toBe("do_not_pay");
  });

  it("does not pay empty accepts", () => {
    expect(evaluatePayment(emptyAccepts, policy).decision).toBe("do_not_pay");
  });

  it("does not pay wrong version", () => {
    expect(evaluatePayment(wrongVersion, policy).decision).toBe("do_not_pay");
  });

  it("summary for base mainnet small contains 0.01", () => {
    expect(evaluatePayment(baseMainnetSmall, policy).summary).toContain("0.01");
  });
});
