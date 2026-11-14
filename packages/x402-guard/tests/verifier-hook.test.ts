import { describe, it, expect } from "vitest";
import { evaluateVerification, paystageVerifierHook } from "../src/verifier-hook.js";

// A policy tight enough to refuse the second payment on size alone, so the decision is unambiguous.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
  allowed_pay_to: ["0xc64a71e150cd21ebc4b12695850bed6b067743bc"],
};

const requirement = (amountAtomic: string) => ({
  scheme: "exact",
  network: "eip155:8453",
  maxAmountRequired: amountAtomic,
  payTo: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
  asset: USDC,
  resource: "https://api.example.com/paid",
  description: "probe",
});

const context = (amountAtomic: string) => ({
  paymentPayload: { payload: "signed" },
  requirements: requirement(amountAtomic),
});

describe("x402 verifier hook", () => {
  it("lets a payment inside the policy through", async () => {
    const outcome = await evaluateVerification(context("2000"), { policy });
    expect(outcome).toBeUndefined();
  });

  it("aborts a payment over the cap, before verification", async () => {
    // 1.00 USDC against a 0.05 cap.
    const outcome = await evaluateVerification(context("1000000"), { policy });
    expect(outcome).toMatchObject({ abort: true });
    if (outcome && "abort" in outcome) {
      expect(outcome.reason).toBeTruthy();
      expect(outcome.message).toContain("refused");
    }
  });

  it("refuses when the policy itself is broken — fail closed, not open", async () => {
    // A hook that threw its way to a pass would look like protection and behave like consent.
    const outcome = await evaluateVerification(context("2000"), { policy: null });
    expect(outcome).toMatchObject({ abort: true, reason: "paystage_evaluation_failed" });
  });

  it("refuses a requirement it cannot price", async () => {
    const outcome = await evaluateVerification(
      { paymentPayload: {}, requirements: { ...requirement(""), maxAmountRequired: "" } },
      { policy },
    );
    expect(outcome).toMatchObject({ abort: true, reason: "paystage_unreadable_amount" });
  });

  it("exposes the hook shape @x402/core registers", () => {
    const ext = paystageVerifierHook({ policy });
    expect(ext.key).toBe("paystage-verifier");
    expect(typeof ext.hooks.beforeVerify).toBe("function");
  });
});
