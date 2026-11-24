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

  it("parses a step_up block with all three thresholds and non-interactive answers", () => {
    const policy = parsePolicy({
      ...validPolicy,
      step_up: {
        amount_above: { value: "0.02", asset: "USDC", decimals: 6 },
        unknown_payee: true,
        first_payment_from_payer: false,
        answers: ["pre_signed_allowance", "second_key", "bounded_auto_approve"],
      },
    });

    expect(policy.step_up?.amount_above?.value).toBe("0.02");
    expect(policy.step_up?.unknown_payee).toBe(true);
    expect(policy.step_up?.first_payment_from_payer).toBe(false);
    expect(policy.step_up?.answers).toHaveLength(3);
  });

  it("rejects a step_up block that cannot fire", () => {
    expect(() => parsePolicy({ ...validPolicy, step_up: {} })).toThrow(
      /step_up needs at least one threshold/,
    );
  });

  it("rejects an empty step_up.answers list", () => {
    expect(() =>
      parsePolicy({
        ...validPolicy,
        step_up: { amount_above: { value: "0.02", asset: "USDC", decimals: 6 }, answers: [] },
      }),
    ).toThrow(/too_small/);
  });

  it("rejects an answer that is not a non-interactive method", () => {
    expect(() =>
      parsePolicy({
        ...validPolicy,
        step_up: { unknown_payee: true, answers: ["browser"] },
      }),
    ).toThrow(/Invalid option/);
  });

  it("rejects a step_up amount with more decimal places than its decimals", () => {
    expect(() =>
      parsePolicy({
        ...validPolicy,
        step_up: { amount_above: { value: "0.0000001", asset: "USDC", decimals: 6 } },
      }),
    ).toThrow(/step_up\.amount_above\.value/);
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
