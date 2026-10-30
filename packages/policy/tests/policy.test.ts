import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/load.js";
import { atomicToHuman, humanToAtomic } from "../src/amounts.js";

const validPolicy = {
  version: 1,
  max_amount: {
    value: "1.00",
    asset: "USDC",
    decimals: 6
  },
  daily_cap: {
    value: "10.00",
    asset: "USDC",
    decimals: 6
  },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      network: "eip155:8453"
    },
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      network: "eip155:84532"
    }
  ],
  allowed_networks: ["eip155:8453", "eip155:84532"],
  max_timeout_seconds: 300,
  require_human_above: {
    value: "0.50",
    asset: "USDC",
    decimals: 6
  },
  unknown_payee: "review"
};

describe("parsePolicy", () => {
  it("parses a valid policy and preserves address fields", () => {
    const policy = parsePolicy(validPolicy);

    expect(policy.version).toBe(1);
    expect(policy.max_amount.value).toBe("1.00");
    expect(policy.daily_cap?.asset).toBe("USDC");
    expect(policy.allowed_pay_to[0]).toBe(
      "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"
    );
    expect(policy.allowed_assets[0].address).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    );
    expect(policy.allowed_assets[1].address).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    );
  });

  it("throws on invalid version", () => {
    expect(() =>
      parsePolicy({ ...validPolicy, version: 2 })
    ).toThrow();
  });

  it("throws on invalid unknown_payee", () => {
    expect(() =>
      parsePolicy({ ...validPolicy, unknown_payee: "hold" })
    ).toThrow();
  });

  it("allows daily_cap and require_human_above to be omitted", () => {
    const { daily_cap, require_human_above, ...rest } = validPolicy;
    const policy = parsePolicy(rest);

    expect(policy.daily_cap).toBeUndefined();
    expect(policy.require_human_above).toBeUndefined();
  });

  it("parses optional auth fields when present", () => {
    const policy = parsePolicy({
      ...validPolicy,
      max_auth_validity_seconds: 600,
      allowed_spenders: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
      disallow_unlimited_approvals: true
    });

    expect(policy.max_auth_validity_seconds).toBe(600);
    expect(policy.allowed_spenders).toEqual([
      "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"
    ]);
    expect(policy.disallow_unlimited_approvals).toBe(true);
  });
});

describe("amount conversion", () => {
  it("converts human decimal strings to atomic BigInt", () => {
    expect(humanToAtomic("1.00", 6)).toBe(1000000n);
    expect(humanToAtomic("0.01", 6)).toBe(10000n);
  });

  it("converts atomic BigInt to human decimal strings", () => {
    expect(atomicToHuman(10000n, 6)).toBe("0.01");
    expect(atomicToHuman(1000000n, 6)).toBe("1");
  });

  it("rejects more fraction digits than decimals", () => {
    expect(() => humanToAtomic("0.0000001", 6)).toThrow();
  });
});
