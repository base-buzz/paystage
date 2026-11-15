import { describe, it, expect, beforeEach } from "vitest";
import { parsePolicyCached, cacheSize, cacheClear } from "../src/policy-cache.js";
import { parsePolicy } from "@paystage/policy";

const POLICY = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
  ],
  allowed_networks: ["eip155:8453"],
  allowed_pay_to: ["0xc64a71e150cd21ebc4b12695850bed6b067743bc"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

beforeEach(() => cacheClear());

describe("policy cache", () => {
  it("returns a verdict-identical policy on the second call", () => {
    const a = parsePolicyCached(POLICY);
    const b = parsePolicyCached({ ...POLICY });
    // Deep-equal, not identity: the contract is that a cached parse behaves exactly like a fresh one.
    expect(b).toEqual(a);
    expect(b).toEqual(parsePolicy(POLICY as never));
  });

  it("holds one entry per distinct policy", () => {
    parsePolicyCached(POLICY);
    parsePolicyCached({ ...POLICY });
    expect(cacheSize()).toBe(1);
    parsePolicyCached({ ...POLICY, max_timeout_seconds: 600 });
    expect(cacheSize()).toBe(2);
  });

  it("still throws the parser's error for an invalid policy", () => {
    expect(() => parsePolicyCached({ version: 1 })).toThrow();
    // A failed parse must not be cached as if it succeeded.
    expect(cacheSize()).toBe(0);
  });

  it("stays bounded when callers send distinct documents", () => {
    for (let i = 0; i < 200; i++) parsePolicyCached({ ...POLICY, max_timeout_seconds: 300 + i });
    expect(cacheSize()).toBeLessThanOrEqual(64);
  });
});
