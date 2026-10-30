import { describe, it, expect } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  type PaymentRequest,
  type AcceptOption,
} from "../src/evaluate";

const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      network: "eip155:8453",
    },
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      network: "eip155:84532",
    },
  ],
  allowed_networks: ["eip155:8453", "eip155:84532"],
  max_timeout_seconds: 300,
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "review",
};

const KNOWN_PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function makeAccept(overrides: Partial<AcceptOption> = {}): AcceptOption {
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

function makeRequest(accepts: AcceptOption[]): PaymentRequest {
  return { x402Version: 2, accepts };
}

describe("evaluatePayment", () => {
  it("returns do_not_pay for empty accepts", () => {
    const r = evaluatePayment(makeRequest([]), policy);
    expect(r.decision).toBe("do_not_pay");
  });

  it("returns do_not_pay for wrong x402Version", () => {
    const r = evaluatePayment(
      { x402Version: 1, accepts: [makeAccept()] },
      policy,
    );
    expect(r.decision).toBe("do_not_pay");
  });

  it("returns do_not_pay for wrong network", () => {
    const r = evaluatePayment(
      makeRequest([makeAccept({ network: "eip155:1" })]),
      policy,
    );
    expect(r.decision).toBe("do_not_pay");
    expect(r.acceptResults[0].status).toBe("do_not_pay");
  });

  it("returns do_not_pay for unknown asset", () => {
    const r = evaluatePayment(
      makeRequest([
        makeAccept({ asset: "0x0000000000000000000000000000000000000000" }),
      ]),
      policy,
    );
    expect(r.decision).toBe("do_not_pay");
  });

  it("returns do_not_pay for over max amount", () => {
    const r = evaluatePayment(
      makeRequest([makeAccept({ amount: "2000000" })]),
      policy,
    );
    expect(r.decision).toBe("do_not_pay");
  });

  it("returns do_not_pay for timeout over policy max", () => {
    const r = evaluatePayment(
      makeRequest([makeAccept({ maxTimeoutSeconds: 301 })]),
      policy,
    );
    expect(r.decision).toBe("do_not_pay");
  });

  it("reviews unknown payee when unknown_payee=review", () => {
    const r = evaluatePayment(
      makeRequest([
        makeAccept({ payTo: "0x0000000000000000000000000000000000000001" }),
      ]),
      policy,
    );
    expect(r.decision).toBe("review");
    expect(r.acceptResults[0].status).toBe("review");
  });

  it("returns do_not_pay for unknown payee when unknown_payee=deny", () => {
    const denyPolicy: Policy = { ...policy, unknown_payee: "deny" };
    const r = evaluatePayment(
      makeRequest([
        makeAccept({ payTo: "0x0000000000000000000000000000000000000001" }),
      ]),
      denyPolicy,
    );
    expect(r.decision).toBe("do_not_pay");
  });

  it("reviews when amount exceeds require_human_above", () => {
    const r = evaluatePayment(
      makeRequest([makeAccept({ amount: "600000" })]),
      policy,
    );
    expect(r.decision).toBe("review");
    expect(r.acceptResults[0].status).toBe("review");
  });

  it("reviews exact max amount when require_human_above is set", () => {
    const r = evaluatePayment(
      makeRequest([makeAccept({ amount: "1000000" })]),
      policy,
    );
    expect(r.decision).toBe("review");
  });

  it("pays exact max amount when require_human_above is unset", () => {
    const noHuman: Policy = { ...policy };
    delete noHuman.require_human_above;
    const r = evaluatePayment(
      makeRequest([makeAccept({ amount: "1000000" })]),
      noHuman,
    );
    expect(r.decision).toBe("pay");
  });

  it("selects cheapest pay-tier accept among multiple", () => {
    const r = evaluatePayment(
      makeRequest([
        makeAccept({ amount: "50000" }),
        makeAccept({ amount: "10000" }),
        makeAccept({ amount: "30000" }),
      ]),
      policy,
    );
    expect(r.decision).toBe("pay");
    expect(r.selectedAccept?.amount).toBe("10000");
  });

  it("matches asset address case-insensitively", () => {
    const r = evaluatePayment(
      makeRequest([makeAccept({ asset: BASE_SEPOLIA_USDC.toUpperCase() })]),
      policy,
    );
    expect(r.decision).toBe("pay");
  });

  it("summary contains human amount 0.01", () => {
    const r = evaluatePayment(makeRequest([makeAccept()]), policy);
    expect(r.decision).toBe("pay");
    expect(r.summary).toContain("0.01");
  });

  it("includes daily_cap note", () => {
    const r = evaluatePayment(makeRequest([makeAccept()]), policy);
    expect(r.dailyCapNote).toBeDefined();
    expect(r.dailyCapNote).toContain("10.00");
  });
});
