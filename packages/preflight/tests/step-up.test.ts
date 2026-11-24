import { describe, expect, it } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  DEFAULT_STEP_UP_ANSWERS,
  type AcceptOption,
  type PaymentHistory,
  type PaymentRequest,
} from "../src/evaluate.js";

const KNOWN_PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const UNSEEN_PAY_TO = "0x0000000000000000000000000000000000000001";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const HISTORY: PaymentHistory = { payees: [KNOWN_PAY_TO], paymentCount: 3 };

/**
 * One policy with all three step-up thresholds off except what a case enables. `max_amount` is 1.00 and the amount
 * step-up is 0.02, so a 0.60 payment crosses the step-up but not the hard ceiling.
 */
function stepUpPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    version: 1,
    max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: [KNOWN_PAY_TO],
    allowed_assets: [
      {
        symbol: "USDC",
        decimals: 6,
        address: BASE_SEPOLIA_USDC,
        network: "eip155:84532",
      },
    ],
    allowed_networks: ["eip155:84532"],
    max_timeout_seconds: 300,
    unknown_payee: "review",
    step_up: {
      amount_above: { value: "0.02", asset: "USDC", decimals: 6 },
      unknown_payee: true,
      answers: ["pre_signed_allowance", "second_key"],
    },
    ...overrides,
  };
}

function accept(overrides: Partial<AcceptOption> = {}): AcceptOption {
  return {
    scheme: "exact",
    network: "eip155:84532",
    amount: "10000",
    payTo: KNOWN_PAY_TO,
    maxTimeoutSeconds: 60,
    asset: BASE_SEPOLIA_USDC,
    ...overrides,
  };
}

function request(overrides: Partial<AcceptOption> = {}): PaymentRequest {
  return { x402Version: 2, accepts: [accept(overrides)] };
}

describe("step-up (#414): a review reason, never a fourth verdict", () => {
  it("pays a small payment to a payee the payer has paid before, with no step-up", () => {
    const result = evaluatePayment(request(), stepUpPolicy(), { paymentHistory: HISTORY });

    expect(result.decision).toBe("pay");
    expect(result.stepUp).toBeUndefined();
    expect(result.packet).toBeUndefined();
    // The thresholds ran and passed; none produced a review outcome or a requirement.
    expect(
      result.steps.some(
        (step) => step.rule.startsWith("accept.step_up") && step.outcome === "review",
      ),
    ).toBe(false);
    expect(result.steps.find((step) => step.rule === "accept.step_up.amount")?.outcome).toBe("pass");
  });

  it("reviews a large payment and names step_up.amount", () => {
    const result = evaluatePayment(request({ amount: "600000" }), stepUpPolicy(), {
      paymentHistory: HISTORY,
    });

    expect(result.decision).toBe("review");
    expect(result.stepUp).toBeDefined();
    expect(result.stepUp!.schema).toBe("paystage.step-up.v1");
    expect(result.stepUp!.trigger).toBe("step_up.amount");
    expect(result.stepUp!.threshold).toBe("0.02 USDC");
    expect(result.stepUp!.answers).toEqual(["pre_signed_allowance", "second_key"]);
    expect(result.stepUp!.fallback).toBe("human");
    expect(result.reasons[0]).toContain("step_up.amount");
    expect(result.reasons[0]).toContain("exceeds step_up.amount_above 0.02 USDC");
    expect(
      result.steps.some(
        (step) => step.rule === "accept.step_up.amount" && step.outcome === "review",
      ),
    ).toBe(true);

    // The packet is the human-readable case, and its share is measured against the step-up threshold that fired.
    expect(result.packet?.step_up).toEqual(result.stepUp);
    expect(result.packet?.rule).toContain("step_up.amount");
    expect(result.packet?.amount.share).toEqual({
      of: "step_up.amount",
      denominator: "0.02 USDC",
      ratio: "3000%",
    });
    // The packet must not claim a later step-up check ran: the evaluator returns at the threshold that fired.
    expect(result.packet?.checked).toContain("step-up amount: crossed at 0.02 USDC");
    expect(
      result.packet?.not_checked.some((line) =>
        line.includes("step-up payee novelty: not checked — an earlier step-up threshold returned review first"),
      ),
    ).toBe(true);
  });

  it("reviews a payee the payer has no record of and names step_up.unknown_payee", () => {
    const result = evaluatePayment(request({ payTo: UNSEEN_PAY_TO }), stepUpPolicy(), {
      paymentHistory: HISTORY,
    });

    expect(result.decision).toBe("review");
    expect(result.stepUp?.trigger).toBe("step_up.unknown_payee");
    expect(result.reasons[0]).toContain("step_up.unknown_payee");
    expect(result.reasons[0]).toContain("no recorded payment to it");
    expect(result.packet?.step_up?.trigger).toBe("step_up.unknown_payee");

    // The three-verdict vocabulary is intact: the decision is `review`, and no `step_up` verdict exists.
    expect(["pay", "review", "do_not_pay"]).toContain(result.decision);
    expect(result.decision).not.toBe("step_up");
  });

  it("treats an allowlisted payee the payer has never paid as novel", () => {
    const result = evaluatePayment(request(), stepUpPolicy(), {
      paymentHistory: { payees: [], paymentCount: 3 },
    });

    expect(result.decision).toBe("review");
    expect(result.stepUp?.trigger).toBe("step_up.unknown_payee");
    expect(result.reasons[0]).toContain("not among the payer's 0 recorded payees");
  });

  it("fails closed when the caller supplies no history: no evidence is not 'no novelty'", () => {
    const result = evaluatePayment(request(), stepUpPolicy());

    expect(result.decision).toBe("review");
    expect(result.stepUp?.trigger).toBe("step_up.unknown_payee");
    expect(result.reasons[0]).toContain("step_up.unknown_payee");
  });

  it("does not override a policy that denies unknown payees", () => {
    const result = evaluatePayment(
      request({ payTo: UNSEEN_PAY_TO }),
      stepUpPolicy({ unknown_payee: "deny" }),
      { paymentHistory: HISTORY },
    );

    expect(result.decision).toBe("do_not_pay");
    expect(result.stepUp).toBeUndefined();
    expect(result.reasons[0]).toContain("not in allowed_pay_to (deny)");
  });

  it("keeps the human path as the fallback, not the only answer", () => {
    const custom = evaluatePayment(request({ amount: "600000" }), stepUpPolicy(), {
      paymentHistory: HISTORY,
    });
    expect(custom.stepUp?.answers).toEqual(["pre_signed_allowance", "second_key"]);

    const defaults = stepUpPolicy({
      step_up: { amount_above: { value: "0.02", asset: "USDC", decimals: 6 } },
    });
    const result = evaluatePayment(request({ amount: "600000" }), defaults, {
      paymentHistory: HISTORY,
    });
    expect(result.stepUp?.answers).toEqual([...DEFAULT_STEP_UP_ANSWERS]);
  });

  it("passes at the threshold and fires only above it", () => {
    const at = evaluatePayment(request({ amount: "20000" }), stepUpPolicy(), {
      paymentHistory: HISTORY,
    });
    expect(at.decision).toBe("pay");

    const above = evaluatePayment(request({ amount: "20001" }), stepUpPolicy(), {
      paymentHistory: HISTORY,
    });
    expect(above.decision).toBe("review");
    expect(above.stepUp?.trigger).toBe("step_up.amount");
  });
});

describe("step-up (#414): first payment from this payer", () => {
  const policy = stepUpPolicy({
    step_up: { first_payment_from_payer: true },
  });

  it("reviews the payer's first ever payment", () => {
    const result = evaluatePayment(request(), policy, {
      paymentHistory: { payees: [], paymentCount: 0 },
    });

    expect(result.decision).toBe("review");
    expect(result.stepUp?.trigger).toBe("step_up.first_payment");
    expect(result.reasons[0]).toContain("step_up.first_payment");
    expect(result.reasons[0]).toContain("first payment needs the principal's attestation");
  });

  it("pays once the payer has a recorded payment", () => {
    const result = evaluatePayment(request(), policy, {
      paymentHistory: { payees: [KNOWN_PAY_TO], paymentCount: 1 },
    });

    expect(result.decision).toBe("pay");
    expect(result.stepUp).toBeUndefined();
  });
});
