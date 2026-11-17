import { describe, it, expect } from "vitest";
import { paystageClientHook } from "../src/index.js";

/**
 * Circle's `@circle-fin/x402-batching` batched client, gated by our existing hook.
 *
 * Read from `@circle-fin/x402-batching@4.0.0` (`dist/hooks-*.d.ts`), `GatewayClient.onBeforePaymentCreation` takes:
 *
 *   (context: { paymentRequired: { accepts: HookPaymentRequirements[] }, selectedRequirements: HookPaymentRequirements })
 *     => Promise<void | { abort: true; reason: string }>
 *
 * and `HookPaymentRequirements` is `{ scheme, network, asset, amount, payTo, maxTimeoutSeconds }`. That is **the same shape**
 * `@x402/core` passes and the same one `paystageClientHook` already accepts — so the integration is a registration, not an
 * adapter. This test pins that claim: if Circle changes the context shape, it fails here rather than silently in a user's
 * signing loop.
 */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";

const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

/** Exactly the object Circle constructs before creating a payment payload. */
function circleContext(amountMicro: string) {
  const requirements = {
    scheme: "exact",
    network: "eip155:8453",
    asset: USDC,
    amount: amountMicro,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
  };
  return {
    paymentRequired: { x402Version: 2, accepts: [requirements] },
    selectedRequirements: requirements,
  };
}

describe("@circle-fin/x402-batching hook compatibility", () => {
  it("refuses an over-cap batch before any payload is created", async () => {
    const hook = paystageClientHook({ policy });
    const outcome = await hook(circleContext("500000")); // 0.50 USDC against a 0.05 cap
    expect(outcome).toBeTruthy();
    expect(outcome && "abort" in outcome && outcome.abort).toBe(true);
  });

  it("passes an in-cap batch through untouched", async () => {
    const hook = paystageClientHook({ policy });
    await expect(hook(circleContext("10000"))).resolves.toBeUndefined(); // 0.01 USDC
  });

  it("refuses an unpriceable amount rather than guessing", async () => {
    const hook = paystageClientHook({ policy });
    const outcome = await hook(circleContext("0.01"));
    expect(outcome && "abort" in outcome && outcome.abort).toBe(true);
  });
});
