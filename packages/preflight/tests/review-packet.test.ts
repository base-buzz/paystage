import { describe, it, expect } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  type AcceptOption,
  type PaymentRequest,
} from "../src/evaluate";

const KNOWN_PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const UNKNOWN_PAY_TO = "0x0000000000000000000000000000000000000001";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
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
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "review",
};

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

describe("review packet", () => {
  it("(a) a review carries all five fields with non-empty values", () => {
    const result = evaluatePayment(
      makeRequest([makeAccept({ payTo: UNKNOWN_PAY_TO })]),
      policy,
    );

    expect(result.decision).toBe("review");
    expect(result.packet).toBeDefined();
    const packet = result.packet!;

    // amount and its share of the applicable cap
    expect(packet.amount.value).toBe("0.01");
    expect(packet.amount.symbol).toBe("USDC");
    expect(packet.amount.share.of).toBe("max_amount");
    expect(packet.amount.share.denominator).toBe("1.00 USDC");
    expect(packet.amount.share.ratio).toBe("1%");

    // payee and the network/asset it is paid in
    expect(packet.payee.address).toBe(UNKNOWN_PAY_TO);
    expect(packet.payee.network).toBe("eip155:84532");
    expect(packet.payee.asset).toBe(BASE_SEPOLIA_USDC);
    expect(packet.payee.symbol).toBe("USDC");

    // rule, checked and not_checked
    expect(packet.rule).toContain("not in allowed_pay_to");
    expect(packet.checked.length).toBeGreaterThan(0);
    expect(packet.not_checked.length).toBeGreaterThan(0);

    // the one question and its two options
    expect(packet.decision.question).toContain("?");
    expect(packet.decision.options).toEqual(["pay", "do_not_pay"]);
  });

  it("(b) a pay verdict carries no packet", () => {
    const result = evaluatePayment(makeRequest([makeAccept()]), policy);
    expect(result.decision).toBe("pay");
    expect(result.packet).toBeUndefined();
  });

  it("(b) a do_not_pay verdict carries no packet either", () => {
    const result = evaluatePayment(
      makeRequest([makeAccept({ amount: "2000000" })]),
      policy,
    );
    expect(result.decision).toBe("do_not_pay");
    expect(result.packet).toBeUndefined();
  });

  it("(c) a review with no applicable policy cap reports the denominator as unknown", () => {
    // `max_amount` is denominated in DAI, so the evaluator skips it (rule 5)
    // instead of comparing a USDC amount against a DAI number. There is no
    // daily_cap and no require_human_above, so no ceiling applies to this review.
    const noCapPolicy: Policy = {
      ...policy,
      max_amount: { value: "1.00", asset: "DAI", decimals: 18 },
      daily_cap: undefined,
      require_human_above: undefined,
    };
    const result = evaluatePayment(
      makeRequest([makeAccept({ payTo: UNKNOWN_PAY_TO })]),
      noCapPolicy,
    );

    expect(result.decision).toBe("review");
    expect(result.packet).toBeDefined();
    expect(result.packet!.amount.share).toEqual({
      of: null,
      denominator: "unknown",
      ratio: "unknown",
    });
  });

  it("(d) the packet's rule is the evaluator's own reason, not a second vocabulary", () => {
    const result = evaluatePayment(
      makeRequest([makeAccept({ amount: "600000" })]),
      policy,
    );

    expect(result.decision).toBe("review");
    const packet = result.packet!;
    const reviewReason = result.acceptResults.find((r) => r.status === "review")?.reasons[0];

    expect(packet.rule).toBe(reviewReason);
    expect(result.reasons).toContain(packet.rule);
    expect(packet.rule).toContain("require_human_above");
  });

  it("names the verified-payee mismatch in checked and rule when a resource host disagrees", () => {
    const result = evaluatePayment(
      {
        x402Version: 2,
        resource: { url: "https://api.paystage.xyz/paid" },
        accepts: [makeAccept({ payTo: KNOWN_PAY_TO })],
      },
      policy,
    );

    expect(result.decision).toBe("review");
    const packet = result.packet!;
    expect(packet.rule).toContain("differs from the verified address");
    expect(packet.checked.some((line) => line.includes("verified-payee registry"))).toBe(true);
    expect(packet.not_checked.some((line) => line.includes("payee-vs-host verification"))).toBe(false);
  });
});
