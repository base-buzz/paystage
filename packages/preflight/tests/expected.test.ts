import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  type AcceptOption,
  type PaymentRequest,
} from "../src/evaluate.js";
import {
  BASE_NETWORK,
  BASE_USDC,
  CATALOGUE_AMOUNT,
  CATALOGUE_PAYEE,
  CHALLENGE_AMOUNT,
  CHALLENGE_PAYEE,
} from "./fixtures/catalogue-mismatch.js";

/**
 * #365: a catalogue is a claim, not the endpoint's own words. The catalogue's payee is different from the challenge's,
 * so an agent that trusts the directory pays an address the endpoint never named. The evaluator is given the claim and
 * must turn a disagreement into `review` with both values, never into `pay`.
 */
const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
  // The live payee is allowed: the review below must come from the catalogue disagreement, not from an unknown payee.
  allowed_pay_to: [CHALLENGE_PAYEE],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: BASE_USDC, network: BASE_NETWORK },
  ],
  allowed_networks: [BASE_NETWORK],
  max_timeout_seconds: 300,
  // 0.05 USDC live is well under this, so the amount threshold cannot be what makes the mismatch case a review.
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "review",
};

const NOT_CHECKED_CATALOGUE =
  "catalogue trustworthiness: a matching catalogue is not an honest payee — it says the address is the one the catalogue meant, nothing about whether that address is trustworthy";

function makeAccept(overrides: Partial<AcceptOption> = {}): AcceptOption {
  return {
    scheme: "exact",
    network: BASE_NETWORK,
    amount: CHALLENGE_AMOUNT,
    payTo: CHALLENGE_PAYEE,
    maxTimeoutSeconds: 60,
    asset: BASE_USDC,
    ...overrides,
  };
}

function makeRequest(accepts: AcceptOption[] = [makeAccept()]): PaymentRequest {
  return { x402Version: 2, accepts };
}

describe("#365 catalogue payee compared at pay time", () => {
  it("returns review naming both payees when the catalogue payee differs", () => {
    const result = evaluatePayment(makeRequest(), policy, {
      expected: { payTo: CATALOGUE_PAYEE },
    });

    expect(result.decision).toBe("review");
    const reason = result.reasons.join(" ");
    expect(reason).toContain("catalogue payee");
    expect(reason).toContain(CATALOGUE_PAYEE);
    expect(reason).toContain("challenge payee");
    expect(reason).toContain(CHALLENGE_PAYEE);
    expect(result.acceptResults[0].status).toBe("review");
    expect(result.steps.some((step) => step.rule === "accept.expected.payTo" && step.outcome === "review")).toBe(true);
  });

  it("makes the packet's question the mismatch, not the amount", () => {
    const result = evaluatePayment(makeRequest(), policy, {
      expected: { payTo: CATALOGUE_PAYEE },
    });

    const packet = result.packet!;
    expect(packet).toBeDefined();
    expect(packet.rule).toContain("catalogue payee");
    expect(packet.decision.question).toContain(CATALOGUE_PAYEE);
    expect(packet.decision.question).toContain(CHALLENGE_PAYEE);
    expect(packet.decision.question).not.toMatch(/^Pay /);
    expect(packet.decision.question).toContain("Catalogue mismatch");
    expect(packet.decision.options).toEqual(["pay", "do_not_pay"]);
  });

  it("states both atomic amounts and the multiple for an amount mismatch", () => {
    const result = evaluatePayment(makeRequest(), policy, {
      expected: { amount: CATALOGUE_AMOUNT },
    });

    expect(result.decision).toBe("review");
    const reason = result.reasons.join(" ");
    expect(reason).toContain(`${CATALOGUE_AMOUNT} atomic`);
    expect(reason).toContain(`${CHALLENGE_AMOUNT} atomic`);
    expect(reason).toContain("4.5×");
    expect(result.packet!.decision.question).toContain(`${CATALOGUE_AMOUNT} atomic`);
    expect(result.packet!.decision.question).toContain(`${CHALLENGE_AMOUNT} atomic`);
    expect(result.packet!.decision.question).toContain("4.5×");
  });

  it("names both values when several supplied fields disagree", () => {
    const result = evaluatePayment(makeRequest(), policy, {
      expected: {
        payTo: CATALOGUE_PAYEE,
        amount: CATALOGUE_AMOUNT,
        network: "eip155:84532",
      },
    });

    expect(result.decision).toBe("review");
    const reason = result.reasons.join(" ");
    expect(reason).toContain("catalogue payee");
    expect(reason).toContain("catalogue amount");
    expect(reason).toContain("catalogue network");
    expect(result.reasons).toHaveLength(3);
  });

  it("adds the catalogue caveat to not_checked", () => {
    const result = evaluatePayment(makeRequest(), policy, {
      expected: { payTo: CATALOGUE_PAYEE },
    });

    expect(result.packet!.not_checked).toContain(NOT_CHECKED_CATALOGUE);
  });

  it("keeps the verdict unchanged when every supplied field matches", () => {
    const expected = {
      payTo: CHALLENGE_PAYEE,
      amount: CHALLENGE_AMOUNT,
      network: BASE_NETWORK,
      asset: BASE_USDC,
    };
    const withExpected = evaluatePayment(makeRequest(), policy, { expected });
    const withoutExpected = evaluatePayment(makeRequest(), policy);

    expect(withExpected.decision).toBe("pay");
    expect(withExpected.decision).toBe(withoutExpected.decision);
    expect(withExpected.selectedAccept).toEqual(withoutExpected.selectedAccept);
    expect(withExpected.acceptResults).toEqual(withoutExpected.acceptResults);
    expect(withExpected.packet).toBeUndefined();
    expect(withExpected.reasons).toEqual([]);
    // The comparison ran and passed; the transcript says so rather than looking like no catalogue was supplied.
    expect(
      withExpected.steps.some((step) => step.rule === "accept.expected" && step.outcome === "pass"),
    ).toBe(true);
  });

  it("compares only the fields a partial claim supplies", () => {
    // Only the payee is claimed. The challenge amount is not the catalogue amount, but the catalogue never claimed an
    // amount, so inferring one would invent a disagreement the directory did not make.
    const payeeOnly = evaluatePayment(makeRequest(), policy, {
      expected: { payTo: CHALLENGE_PAYEE },
    });
    expect(payeeOnly.decision).toBe("pay");

    const payeeOnlyMismatch = evaluatePayment(makeRequest(), policy, {
      expected: { payTo: CATALOGUE_PAYEE },
    });
    expect(payeeOnlyMismatch.decision).toBe("review");
    expect(payeeOnlyMismatch.reasons).toHaveLength(1);
    expect(payeeOnlyMismatch.reasons[0]).toContain("catalogue payee");
    expect(payeeOnlyMismatch.reasons[0]).not.toContain("catalogue amount");
  });

  it("still reports the caveat when the catalogue matched but another rule held the payment", () => {
    // 0.60 USDC crosses require_human_above; the catalogue claim matches, so the caveat must still be present.
    const result = evaluatePayment(makeRequest([makeAccept({ amount: "600000" })]), policy, {
      expected: { payTo: CHALLENGE_PAYEE, amount: "600000" },
    });

    expect(result.decision).toBe("review");
    expect(result.packet!.rule).toContain("require_human_above");
    expect(result.packet!.not_checked).toContain(NOT_CHECKED_CATALOGUE);
    expect(result.packet!.decision.question).toMatch(/^Pay /);
  });

  it("does not ask the human about the catalogue when an earlier hard deny fired", () => {
    // The live amount is over max_amount: do_not_pay is a stronger refusal than review and must win.
    const result = evaluatePayment(makeRequest([makeAccept({ amount: "2000000" })]), policy, {
      expected: { payTo: CATALOGUE_PAYEE, amount: CATALOGUE_AMOUNT },
    });

    expect(result.decision).toBe("do_not_pay");
    expect(result.packet).toBeUndefined();
    expect(result.reasons.join(" ")).toContain("max_amount");
  });
});

describe("#365 expected claim absent is byte-identical to the pre-change fixture", () => {
  it("returns the same EVM pay and review results as the stored baseline", () => {
    const baseline = JSON.parse(
      readFileSync(new URL("./fixtures/evm-verdict-baseline.json", import.meta.url), "utf8"),
    ) as {
      policy: Parameters<typeof evaluatePayment>[1];
      pay: ReturnType<typeof evaluatePayment>;
      review: ReturnType<typeof evaluatePayment>;
    };
    const accept: AcceptOption = {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };
    const req = (a: AcceptOption): PaymentRequest => ({
      x402Version: 2,
      accepts: [a],
      resource: { url: "mcp://tool/demo" },
    });

    // No `expected` key at all: the rule does not run, adds no step, and cannot change a verdict or a packet.
    expect(evaluatePayment(req(accept), baseline.policy)).toEqual(baseline.pay);
    expect(evaluatePayment(req({ ...accept, amount: "600000" }), baseline.policy)).toEqual(
      baseline.review,
    );
  });
});
