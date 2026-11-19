import { describe, expect, it } from "vitest";
import { paystagePlugin, resolvePolicy } from "./index.js";

/**
 * The done-when for this package: an over-cap payment returns `do_not_pay` **without network access**. That is the whole promise of
 * the local evaluator, and a test that needs a network cannot prove it.
 */
const policy = {
  version: 1,
  max_amount: { value: "1", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 600,
  unknown_payee: "deny",
} as never;

const message = (amount: string) => ({
  content: {
    paymentRequired: {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount,
          payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
          maxTimeoutSeconds: 300,
        },
      ],
    },
  },
});

const runtime = { getSetting: () => undefined };

describe("elizaOS plugin", () => {
  it("returns do_not_pay for an over-cap payment, offline", async () => {
    const plugin = paystagePlugin({ policy });
    const action = plugin.actions?.[0];
    const result = await action!.handler(runtime, message("2500000")); // 2.5 USDC against a 1 USDC ceiling
    expect(result.data?.decision).toBe("do_not_pay");
    expect(String(result.text)).toMatch(/paystage: do_not_pay/);
  });

  it("returns pay within the ceiling", async () => {
    const plugin = paystagePlugin({ policy });
    const result = await plugin.actions![0].handler(runtime, message("500000"));
    expect(result.data?.decision).toBe("pay");
  });

  it("refuses to guess a spend ceiling when no policy is configured", async () => {
    const plugin = paystagePlugin();
    const result = await plugin.actions![0].handler(runtime, message("1000"));
    expect(result.success).toBe(false);
    expect(result.data?.decision).toBe("review");
    expect(String(result.text)).toMatch(/no policy configured/i);
  });

  it("reads a policy from the runtime setting", () => {
    const runtimeWithSetting = { getSetting: (key: string) => (key === "PAYSTAGE_POLICY" ? JSON.stringify(policy) : undefined) };
    expect(resolvePolicy(runtimeWithSetting, {})?.allowed_networks).toEqual(["eip155:8453"]);
  });

  it("describes the active policy in the provider", async () => {
    const plugin = paystagePlugin({ policy });
    const text = await plugin.providers![0].get(runtime, {});
    expect(text).toContain("ceiling 1 USDC");
    expect(text).toContain("eip155:8453");
  });
});
