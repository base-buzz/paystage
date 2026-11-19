import { describe, expect, it } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";
import type { Policy } from "@paystage/policy";

/**
 * #37 — one asset entry, several networks.
 *
 * The boundary that matters: omitting `network` widens the *asset match*, and must not widen the *network* allow-list. A
 * policy listing USDC by address for Base and Base Sepolia must still refuse the same address on any other chain.
 */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OTHER = "0x1111111111111111111111111111111111111111";

const policy = {
  version: 1,
  max_amount: { value: "5", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x2222222222222222222222222222222222222222"],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC_BASE }],
  allowed_networks: ["eip155:8453", "eip155:84532"],
  max_timeout_seconds: 600,
  unknown_payee: "deny",
} as unknown as Policy;

const paymentOn = (network: string, asset: string, payTo = "0x2222222222222222222222222222222222222222") => ({
  x402Version: 2 as const,
  accepts: [{ scheme: "exact", network, asset, amount: "1000000", payTo, maxTimeoutSeconds: 300 }],
}) as never;

describe("network-agnostic asset entries", () => {
  it("allows the address on a permitted network", () => {
    const result = evaluatePayment(paymentOn("eip155:8453", USDC_BASE), policy);
    expect(result.accepts?.[0]?.status ?? result.decision).not.toBe("do_not_pay");
  });

  it("allows the same address on the second permitted network", () => {
    const result = evaluatePayment(paymentOn("eip155:84532", USDC_BASE), policy);
    expect(result.accepts?.[0]?.status ?? result.decision).not.toBe("do_not_pay");
  });

  it("still refuses the same address on a network the policy does not list", () => {
    const result = evaluatePayment(paymentOn("eip155:1", USDC_BASE), policy);
    expect(result.accepts?.[0]?.status ?? result.decision).toBe("do_not_pay");
  });

  it("still refuses a different address on a permitted network", () => {
    const result = evaluatePayment(paymentOn("eip155:8453", OTHER), policy);
    expect(result.accepts?.[0]?.status ?? result.decision).toBe("do_not_pay");
  });
});
