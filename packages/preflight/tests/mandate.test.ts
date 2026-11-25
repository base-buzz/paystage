import { describe, expect, it } from "vitest";
import type { Policy } from "@paystage/policy";
import { evaluateMandate, issue } from "@paystage/mandate";
import {
  evaluatePayment,
  type AcceptOption,
  type MandateEvaluationInput,
  type PaymentRequest,
} from "../src/evaluate.js";

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NOW = new Date("2026-11-15T12:00:00.000Z");

/** Permissive policy: the mandate is the only thing that should refuse these payments. */
function policy(): Policy {
  return {
    version: 1,
    max_amount: { value: "10.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: [PAY_TO],
    allowed_assets: [
      { symbol: "USDC", decimals: 6, address: BASE_SEPOLIA_USDC, network: "eip155:84532" },
    ],
    allowed_networks: ["eip155:84532"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  };
}

function accept(overrides: Partial<AcceptOption> = {}): AcceptOption {
  return {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1000000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    asset: BASE_SEPOLIA_USDC,
    ...overrides,
  };
}

function request(overrides: Partial<AcceptOption> = {}): PaymentRequest {
  return { x402Version: 2, accepts: [accept(overrides)] };
}

async function mandateInput(): Promise<MandateEvaluationInput> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const mandate = await issue(
    {
      principal: "Northwind Ltd",
      agent: "shopping-agent-7",
      serial: "vch_0123456789abcdefghijkl",
      scope: { per_payment: "2.00", window_amount: "20.00", window_seconds: 86400 },
      issued_at: "2026-11-01T00:00:00.000Z",
      expires_at: "2026-12-01T00:00:00.000Z",
    },
    { privateKey: pair.privateKey, kid: "k-test", now: new Date("2026-11-01T00:00:00.000Z") },
  );
  return { mandate };
}

describe("evaluatePayment + mandate (#412)", () => {
  it("passes a payment inside the mandate", async () => {
    const result = evaluatePayment(request({ amount: "1500000" }), policy(), {
      mandate: await mandateInput(),
      now: NOW,
    });

    expect(result.decision).toBe("pay");
    const step = result.steps.find((entry) => entry.rule === "accept.mandate");
    expect(step?.outcome).toBe("pass");
    expect(step?.detail).toContain("vch_0123456789abcdefghijkl");
  });

  it("refuses a payment outside the mandate and names mandate.per-payment, not just 'outside mandate'", async () => {
    const result = evaluatePayment(request({ amount: "3000000" }), policy(), {
      mandate: await mandateInput(),
      now: NOW,
    });

    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.join(" ")).toContain("mandate.per-payment");
    expect(result.reasons.join(" ")).toContain("exceeds per_payment 2.00 USDC");
    expect(result.steps.find((entry) => entry.rule === "accept.mandate.per-payment")?.outcome).toBe("fail");
  });

  it("refuses a payment outside the rolling window and names mandate.window", async () => {
    const input = await mandateInput();
    const result = evaluatePayment(request({ amount: "1500000" }), policy(), {
      mandate: {
        ...input,
        history: [{ amount: "19000000", at: "2026-11-15T10:00:00.000Z" }],
      },
      now: NOW,
    });

    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.join(" ")).toContain("mandate.window");
    expect(result.steps.find((entry) => entry.rule === "accept.mandate.window")?.outcome).toBe("fail");
  });

  it("agrees with @paystage/mandate's evaluator on which rule fails", async () => {
    const input = await mandateInput();
    const cases = [
      { amount: "1500000", history: undefined, rule: undefined },
      { amount: "3000000", history: undefined, rule: "per-payment" },
      {
        amount: "1500000",
        history: [{ amount: "19000000", at: "2026-11-15T10:00:00.000Z" }],
        rule: "window",
      },
    ] as const;

    for (const testCase of cases) {
      const direct = evaluateMandate({
        mandate: input.mandate,
        payment: { amount: testCase.amount, payee: PAY_TO, decimals: 6, symbol: "USDC" },
        ...(testCase.history === undefined ? {} : { history: testCase.history }),
        now: NOW,
      });
      const viaPreflight = evaluatePayment(request({ amount: testCase.amount }), policy(), {
        mandate: {
          ...input,
          ...(testCase.history === undefined ? {} : { history: testCase.history }),
        },
        now: NOW,
      });

      if (testCase.rule === undefined) {
        expect(direct.ok).toBe(true);
        expect(viaPreflight.decision).toBe("pay");
      } else {
        expect(direct).toMatchObject({ ok: false, rule: testCase.rule });
        expect(viaPreflight.reasons.join(" ")).toContain(`mandate.${testCase.rule}`);
      }
    }
  });
});
