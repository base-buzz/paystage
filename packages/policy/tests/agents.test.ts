import { describe, expect, it } from "vitest";
import { findWidening, resolveAgentPolicy } from "../src/agents.js";
import type { Policy } from "../src/types.js";

const USDC = {
  symbol: "USDC",
  decimals: 6,
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
};

const base: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "20.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"],
  allowed_assets: [USDC],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "review",
};

describe("resolveAgentPolicy", () => {
  it("passes the global policy through when no agents are declared", () => {
    const result = resolveAgentPolicy(base, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.agentId).toBe("default");
  });

  it("denies a missing identity once agents are declared", () => {
    const policy: Policy = { ...base, agents: { "reader": { max_amount: { value: "0.10", asset: "USDC", decimals: 6 } } } };
    const result = resolveAgentPolicy(policy, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/agent_id/);
  });

  it("denies an unknown agent rather than falling back to the global policy", () => {
    const policy: Policy = { ...base, agents: { "reader": {} } };
    const result = resolveAgentPolicy(policy, "trader");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown agent/);
  });

  it("narrows the ceiling for a known agent", () => {
    const policy: Policy = {
      ...base,
      agents: { reader: { max_amount: { value: "0.10", asset: "USDC", decimals: 6 } } },
    };
    const result = resolveAgentPolicy(policy, "reader");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policy.max_amount.value).toBe("0.10");
  });

  it("rejects an override that raises the ceiling", () => {
    const policy: Policy = {
      ...base,
      agents: { trader: { max_amount: { value: "50.00", asset: "USDC", decimals: 6 } } },
    };
    const result = resolveAgentPolicy(policy, "trader");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/above the policy max_amount/);
  });

  it("rejects an override that adds a payee", () => {
    const policy: Policy = {
      ...base,
      agents: { trader: { allowed_pay_to: ["0x3333333333333333333333333333333333333333"] } },
    };
    const result = resolveAgentPolicy(policy, "trader");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/outside the policy list/);
  });

  it("rejects loosening unknown_payee from deny to review", () => {
    const policy: Policy = {
      ...base,
      unknown_payee: "deny",
      agents: { trader: { unknown_payee: "review" } },
    };
    expect(resolveAgentPolicy(policy, "trader").ok).toBe(false);
  });

  it("allows tightening unknown_payee from review to deny", () => {
    const policy: Policy = { ...base, unknown_payee: "review", agents: { trader: { unknown_payee: "deny" } } };
    const result = resolveAgentPolicy(policy, "trader");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policy.unknown_payee).toBe("deny");
  });
});

describe("findWidening", () => {
  it("compares amounts in base units, not lexically", () => {
    // "9.00" > "10.00" as strings; as amounts it is smaller, so this must pass.
    expect(findWidening({ ...base, max_amount: { value: "10.00", asset: "USDC", decimals: 6 } }, {
      max_amount: { value: "9.00", asset: "USDC", decimals: 6 },
    })).toBeUndefined();
  });

  it("treats address comparison as case-insensitive", () => {
    expect(findWidening(base, { allowed_pay_to: ["0x1111111111111111111111111111111111111111".toUpperCase()] }))
      .toBeUndefined();
  });
});
