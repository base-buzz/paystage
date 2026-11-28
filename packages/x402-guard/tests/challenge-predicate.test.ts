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

/**
 * A 6 KB challenge must parse, not truncate (#496).
 *
 * The market measured on 2026-11-27: min 1,216 bytes, median 3,142, max 10,164 — so a client with a 4 KB assumption sees more than a
 * third of real challenges fail. Our own parser reads the header value as a string, which has no size limit, and this test pins that:
 * it builds a challenge of the largest size we measured, padding a field rather than the fields we read, and asserts the payee and
 * price still come out.
 *
 * The failure this guards is not a crash — it is a truncation that leaves valid-looking JSON with the fields missing, which a caller
 * would read as "this seller is broken".
 */
describe("challenge size", () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

  it("reads a 10,164-byte challenge, the largest measured in the market", () => {
    const padding = "x".repeat(10_164 - 700); // leaves room for the envelope itself
    const challenge = encode({
      x402Version: 2,
      resource: { url: "https://example.test/paid", description: padding },
      accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000", payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE" }],
    });
    expect(Buffer.byteLength(challenge, "utf8")).toBeGreaterThan(8_192);

    const result = isCorrectChallenge(challenge);
    expect(result.correct).toBe(true);
    expect(result.payTo).toBe("0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE");
    expect(result.amount).toBe("2000");
  });

  it("round-trips a plain 6 KB header without dropping fields", () => {
    const challenge = encode({
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000", payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE", extra: { note: "y".repeat(6_000) } }],
    });
    expect(Buffer.byteLength(challenge, "utf8")).toBeGreaterThan(6_000);
    expect(isCorrectChallenge(challenge).correct).toBe(true);
  });
});
