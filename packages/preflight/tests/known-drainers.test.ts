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

  it("matches burn address case-insensitively", () => {
    expect(isKnownDrainer(DEAD)).toBe(true);
    expect(isKnownDrainer(DEAD.toLowerCase())).toBe(true);
  });

  it("rejects unknown addresses", () => {
    expect(isKnownDrainer(UNKNOWN)).toBe(false);
  });

  it("hard-denies known drainers before unknown_payee review", () => {
    const result = evaluatePayment(req(DEAD), policy);
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.some((r) => /known drainer/i.test(r))).toBe(true);
  });
});

describe("known-drainers 2026-11-02 refresh", () => {
  const added = [
    "0x0b5126e1bc27c0de77e02e97945760a674edb034",
    "0xcdfe91301356da873562ef513828a60dba1f569d",
    "0x616000e384ef1c2b52f5f3a88d57a3b64f23757e",
    "0xc9002a87e2e3efdcc26cfb0bc9034b919d38fb03",
    "0x101a548bcda171b5f00179aaca0ac32074a2b86a",
    "0x678245175aae05ba3301a7812a38f1a2592a97a8",
    "0x9cc58d06f299f2a37050403eb9c90482f38ee3ad",
  ];

  it("includes newly cited Base/EVM drain addresses", () => {
    expect(KNOWN_DRAINERS.length).toBe(17);
    for (const a of added) {
      expect(isKnownDrainer(a)).toBe(true);
      expect(isKnownDrainer(a.toUpperCase())).toBe(true);
    }
  });

  it("still rejects an unsourced random address", () => {
    expect(isKnownDrainer(UNKNOWN)).toBe(false);
  });
});
