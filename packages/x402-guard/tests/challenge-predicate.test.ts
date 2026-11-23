import { describe, expect, it } from "vitest";
import { isCorrectChallenge } from "../src/challenge-predicate.js";

/**
 * The four fixtures #389 asks for, plus the two shapes the real probe met on 2026-11-23: a v1 challenge that carries `maxAmountRequired` instead of `amount`, and an
 * endpoint that answers 402 with no challenge at all. Comparability is the point — next month's "97%" has to be measured with these.
 */
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("isCorrectChallenge", () => {
  it("accepts a valid v2 challenge: payee, numeric amount, parseable header", () => {
    const result = isCorrectChallenge(b64({ x402Version: 2, accepts: [{ payTo: "0xabc", amount: "10000" }] }));
    expect(result.correct).toBe(true);
    expect(result.payTo).toBe("0xabc");
    expect(result.amount).toBe("10000");
  });

  it("rejects a challenge with no payee", () => {
    const result = isCorrectChallenge(b64({ x402Version: 2, accepts: [{ amount: "10000" }] }));
    expect(result.correct).toBe(false);
    expect(result.reason).toMatch(/no payee/);
  });

  it("rejects a non-numeric amount", () => {
    const result = isCorrectChallenge(b64({ x402Version: 2, accepts: [{ payTo: "0xabc", amount: "free" }] }));
    expect(result.correct).toBe(false);
    expect(result.reason).toMatch(/not numeric/);
  });

  it("rejects an unparseable header", () => {
    const result = isCorrectChallenge("not-base64-or-json");
    expect(result.correct).toBe(false);
    expect(result.reason).toMatch(/no parseable payment-required/);
  });

  it("accepts the v1 shape that carries maxAmountRequired", () => {
    const result = isCorrectChallenge(b64({ x402Version: 1, accepts: [{ payTo: "0xabc", maxAmountRequired: "5000" }] }));
    expect(result.correct).toBe(true);
    expect(result.amount).toBe("5000");
  });
});
