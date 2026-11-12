import { describe, it, expect } from "vitest";
import { decodeSettlement, normalisePayer } from "../src/settlement.js";

/**
 * Payer capture. Every event row until now had `tx_hash: null`, so "how many distinct
 * addresses paid us" was unanswerable — the honest answer to a stranger was "we do not know".
 */

const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

describe("decodeSettlement", () => {
  it("reads the receipt the middleware echoes", () => {
    const r = decodeSettlement(encode({ success: true, payer: "0xABC", transaction: "0xdead" }));
    expect(r?.payer).toBe("0xABC");
    expect(r?.transaction).toBe("0xdead");
  });

  it("accepts txHash as well as transaction", () => {
    expect(decodeSettlement(encode({ txHash: "0xbeef" }))?.txHash).toBe("0xbeef");
  });

  it("returns null for a missing header rather than guessing", () => {
    expect(decodeSettlement(null)).toBeNull();
  });

  it("returns null for garbage instead of throwing", () => {
    expect(decodeSettlement("!!!not base64!!!")).toBeNull();
    expect(decodeSettlement(Buffer.from("[]").toString("base64"))).toBeNull();
  });
});

describe("normalisePayer", () => {
  it("lowercases, so one payer cannot count twice by casing", () => {
    expect(normalisePayer("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("rejects anything that is not an address", () => {
    for (const bad of [undefined, null, "", "0x123", "not-an-address", 42]) {
      expect(normalisePayer(bad)).toBeNull();
    }
  });

  it("keeps the checksum of the input out of the identity", () => {
    const a = normalisePayer("0xABCDEF0123456789ABCDEF0123456789ABCDEF01");
    const b = normalisePayer("0xabcdef0123456789abcdef0123456789abcdef01");
    expect(a).toBe(b);
  });
});
