import { describe, it, expect } from "vitest";
import {
  isKnownDrainer,
  KNOWN_DRAINERS,
  SOURCES,
} from "../src/known-drainers.js";
import { evaluatePayment } from "../src/evaluate.js";
import type { Policy } from "@paystage/policy";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const UNKNOWN = "0x1111111111111111111111111111111111111111";
const ALLOWED = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const SEPOLIA = "eip155:84532";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [ALLOWED],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: USDC, network: SEPOLIA },
  ],
  allowed_networks: [SEPOLIA],
  max_timeout_seconds: 300,
  unknown_payee: "review",
};

function req(payTo: string) {
  return {
    x402Version: 2 as const,
    accepts: [
      {
        scheme: "exact",
        network: SEPOLIA,
        amount: "2000",
        asset: USDC,
        payTo,
        maxTimeoutSeconds: 60,
      },
    ],
  };
}

describe("known-drainers", () => {
  it("exports curated list with sources", () => {
    expect(KNOWN_DRAINERS.length).toBeGreaterThan(0);
    expect(SOURCES.length).toBeGreaterThan(0);
    for (const s of SOURCES) {
      expect(s.url).toMatch(/^https?:\/\//);
    }
  });

  it("isKnownDrainer is case-insensitive", () => {
    expect(isKnownDrainer(DEAD)).toBe(true);
    expect(isKnownDrainer(DEAD.toLowerCase())).toBe(true);
    expect(isKnownDrainer("0x000000000000000000000000000000000000DEAD")).toBe(
      true,
    );
    expect(isKnownDrainer(UNKNOWN)).toBe(false);
    expect(isKnownDrainer("")).toBe(false);
  });

  it("evaluatePayment hard-denies known drainers", () => {
    const result = evaluatePayment(req(DEAD), policy);
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.some((r) => /known drainer/i.test(r))).toBe(true);
  });

  it("evaluatePayment reviews unknown non-listed payee", () => {
    const result = evaluatePayment(req(UNKNOWN), policy);
    expect(result.decision).toBe("review");
    expect(result.reasons.some((r) => /not in allowed_pay_to/i.test(r))).toBe(
      true,
    );
  });

  it("evaluatePayment still pays allowed payee", () => {
    const result = evaluatePayment(req(ALLOWED), policy);
    expect(result.decision).toBe("pay");
  });
});
