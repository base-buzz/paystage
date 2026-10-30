import { describe, expect, it } from "vitest";
import type { Policy } from "@paystage/policy";
import { evaluateOutstandingAuths } from "../src/evaluate.js";
import type { AuthItem } from "../src/types.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const KNOWN_SPENDER = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const UNKNOWN_SPENDER = "0x9999999999999999999999999999999999999999";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const basePolicy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [KNOWN_SPENDER],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "review"
};

function makeItem(overrides: Partial<AuthItem> = {}): AuthItem {
  return {
    kind: "erc20_allowance",
    token: USDC,
    owner: OWNER,
    spender: KNOWN_SPENDER,
    amount: 1000000n,
    network: "eip155:8453",
    ...overrides
  };
}

describe("evaluateOutstandingAuths", () => {
  it("returns ok for a small allowance to a known spender", () => {
    const [result] = evaluateOutstandingAuths([makeItem()], basePolicy);
    expect(result.flags).toEqual([]);
    expect(result.summary).toBe("ok");
  });

  it("flags unlimited allowances and recommends revoke", () => {
    const [result] = evaluateOutstandingAuths(
      [makeItem({ amount: 2n ** 255n })],
      basePolicy
    );
    expect(result.flags).toContain("unlimited");
    expect(result.summary).toBe("revoke_recommended");
  });

  it("flags unknown spenders and reviews under review policy", () => {
    const [result] = evaluateOutstandingAuths(
      [makeItem({ spender: UNKNOWN_SPENDER })],
      basePolicy
    );
    expect(result.flags).toContain("unknown_spender");
    expect(result.summary).toBe("review");
  });

  it("recommends revoke for unknown spender under deny policy", () => {
    const denyPolicy: Policy = { ...basePolicy, unknown_payee: "deny" };
    const [result] = evaluateOutstandingAuths(
      [makeItem({ spender: UNKNOWN_SPENDER })],
      denyPolicy
    );
    expect(result.flags).toContain("unknown_spender");
    expect(result.summary).toBe("revoke_recommended");
  });

  it("uses allowed_spenders when provided", () => {
    const policy: Policy = {
      ...basePolicy,
      allowed_spenders: [UNKNOWN_SPENDER]
    };
    const [result] = evaluateOutstandingAuths(
      [makeItem({ spender: UNKNOWN_SPENDER })],
      policy
    );
    expect(result.flags).not.toContain("unknown_spender");
    expect(result.summary).toBe("ok");
  });

  it("matches spenders case-insensitively", () => {
    const [result] = evaluateOutstandingAuths(
      [makeItem({ spender: KNOWN_SPENDER.toLowerCase() })],
      basePolicy
    );
    expect(result.flags).not.toContain("unknown_spender");
  });

  it("flags stale authorizations with past expiration", () => {
    const now = 1_000_000;
    const [result] = evaluateOutstandingAuths(
      [makeItem({ expirationSeconds: now - 1 })],
      basePolicy,
      now
    );
    expect(result.flags).toContain("stale");
    expect(result.summary).toBe("review");
  });

  it("does not flag expiration of zero as stale", () => {
    const now = 1_000_000;
    const [result] = evaluateOutstandingAuths(
      [makeItem({ expirationSeconds: 0 })],
      basePolicy,
      now
    );
    expect(result.flags).not.toContain("stale");
  });

  it("does not flag future expiration as stale", () => {
    const now = 1_000_000;
    const [result] = evaluateOutstandingAuths(
      [makeItem({ expirationSeconds: now + 1000 })],
      basePolicy,
      now
    );
    expect(result.flags).not.toContain("stale");
  });

  it("evaluates multiple items independently", () => {
    const results = evaluateOutstandingAuths(
      [
        makeItem(),
        makeItem({ amount: 2n ** 255n }),
        makeItem({ spender: UNKNOWN_SPENDER })
      ],
      basePolicy
    );
    expect(results).toHaveLength(3);
    expect(results[0].summary).toBe("ok");
    expect(results[1].summary).toBe("revoke_recommended");
    expect(results[2].summary).toBe("review");
  });
});
