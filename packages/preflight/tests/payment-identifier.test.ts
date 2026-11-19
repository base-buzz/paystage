import { beforeEach, describe, expect, it } from "vitest";
import { evaluatePayment, resetPaymentIdentifierCache, DEFAULT_DEDUP_WINDOW_MS } from "../src/evaluate.js";
import type { Policy } from "@paystage/policy";

/**
 * #187 / issue #228: the evaluator is stateless, so a retry loop gets a second `pay` for one purchase.
 *
 * The fix is not a stateful approval cache — it is to notice that the caller handed us the same identifier twice and to stop calling the second one an approval.
 */
const PAY_TO = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const policy = {
  version: 1,
  max_amount: { value: "5", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: PAY_TO }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 600,
} as unknown as Policy;

const payment = () =>
  ({
    x402Version: 2,
    resource: { url: "https://seller.example/paid" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: PAY_TO,
        amount: "1000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
      },
    ],
  }) as never;

const at = (ms: number) => ({ now: new Date(1_700_000_000_000 + ms) });

beforeEach(() => resetPaymentIdentifierCache());

describe("payment identifier dedup", () => {
  it("pays the first time an identifier is seen", () => {
    const result = evaluatePayment(payment(), policy, { paymentIdentifier: "abc-123", ...at(0) });
    expect(result.decision).toBe("pay");
  });

  it("reviews, never pays, when the same identifier is retried inside the window", () => {
    evaluatePayment(payment(), policy, { paymentIdentifier: "abc-123", ...at(0) });
    const retry = evaluatePayment(payment(), policy, { paymentIdentifier: "abc-123", ...at(30_000) });
    expect(retry.decision).toBe("review");
    expect(retry.reasons.join(" ")).toMatch(/retried preflight is not a second approval/);
    // The summary must agree with the decision, or a reader of the JSON sees `review` above a sentence that says pay.
    expect(retry.summary).toMatch(/^Decision: review/);
  });

  it("pays again once the window has passed", () => {
    evaluatePayment(payment(), policy, { paymentIdentifier: "abc-123", ...at(0) });
    const later = evaluatePayment(payment(), policy, {
      paymentIdentifier: "abc-123",
      ...at(DEFAULT_DEDUP_WINDOW_MS + 1),
    });
    expect(later.decision).toBe("pay");
  });

  it("does not let one identifier suppress a different purchase", () => {
    evaluatePayment(payment(), policy, { paymentIdentifier: "abc-123", ...at(0) });
    const other = evaluatePayment(payment(), policy, { paymentIdentifier: "def-456", ...at(1000) });
    expect(other.decision).toBe("pay");
  });

  it("is unchanged when no identifier is supplied — the stateless contract stays the default", () => {
    expect(evaluatePayment(payment(), policy, at(0)).decision).toBe("pay");
    expect(evaluatePayment(payment(), policy, at(1000)).decision).toBe("pay");
  });

  it("leaves refusals alone: a repeat of a refusal is not a retry worth suppressing", () => {
    const expensive = payment() as { accepts: { amount: string }[] };
    expensive.accepts[0]!.amount = "999999999";
    const first = evaluatePayment(expensive as never, policy, { paymentIdentifier: "big-1", ...at(0) });
    const second = evaluatePayment(expensive as never, policy, { paymentIdentifier: "big-1", ...at(1000) });
    expect(first.decision).toBe("do_not_pay");
    expect(second.decision).toBe(first.decision);
  });

  it("refuses to cache an absurdly long identifier", () => {
    const long = "x".repeat(200);
    const result = evaluatePayment(payment(), policy, { paymentIdentifier: long, ...at(0) });
    expect(result.decision).toBe("review");
    expect(result.reasons.join(" ")).toMatch(/200 characters/);
  });
});
