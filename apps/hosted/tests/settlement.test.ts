import { describe, it, expect } from "vitest";
import {
  atomicToUsdc,
  decodePaymentSignature,
  decodeSettlement,
  normalisePayer,
  settlementEvent,
} from "../src/settlement.js";

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

/**
 * Amounts and payees (#131). `events.amount_usdc` and `pay_to` were queried by the lander strip and
 * never written, so "settled" counted and the volume read 0.000 USDC. A zero that looks like "no
 * volume" is the same failure as a green check that measured nothing.
 */
describe("atomicToUsdc", () => {
  it("converts atomic units at six decimals", () => {
    expect(atomicToUsdc("2000")).toBe(0.002);
    expect(atomicToUsdc("1000000")).toBe(1);
    expect(atomicToUsdc(50000)).toBe(0.05);
  });

  it("returns null rather than guessing a scale", () => {
    for (const bad of ["", "abc", "1.5", "-1", null, undefined, {}]) {
      expect(atomicToUsdc(bad)).toBeNull();
    }
  });
});

describe("decodePaymentSignature", () => {
  const signed = encode({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "2000",
      payTo: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
  });

  it("reads the payee and amount the caller signed for", () => {
    const out = decodePaymentSignature(signed);
    expect(out.payTo).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(out.atomicAmount).toBe("2000");
  });

  it("returns nulls for a missing or malformed header", () => {
    for (const bad of [null, undefined, "", "!!!not base64!!!", encode({ accepted: null })]) {
      const out = decodePaymentSignature(bad as string | null | undefined);
      expect(out.payTo).toBeNull();
      expect(out.atomicAmount).toBeNull();
    }
  });
});

describe("settlementEvent", () => {
  const paymentHeader = encode({
    accepted: { payTo: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "2000" },
  });

  it("records the amount and the payee, which is what the volume figure needs", () => {
    const row = settlementEvent({
      receipt: { success: true, payer: "0xABCDEF0123456789ABCDEF0123456789ABCDEF01", transaction: "0xfeed", amount: "2000" },
      paymentHeader,
      tool: "evaluate_mcp_payment",
      source: "synthetic",
      channel: "glama",
    });
    expect(row.decision).toBe("settled");
    expect(row.amount_usdc).toBe(0.002);
    expect(row.pay_to).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(row.reason_codes).toEqual([]);
    expect(row.channel).toBe("glama");
  });

  it("falls back to the signed amount when the receipt omits one", () => {
    const row = settlementEvent({
      receipt: { success: true, payer: "0xABCDEF0123456789ABCDEF0123456789ABCDEF01" },
      paymentHeader,
      tool: "evaluate_mcp_payment",
      source: "synthetic",
    });
    expect(row.amount_usdc).toBe(0.002);
  });

  it("says which field is missing instead of recording a silent zero", () => {
    const row = settlementEvent({
      receipt: { success: true },
      paymentHeader: null,
      tool: "evaluate_mcp_payment",
      source: "real",
    });
    expect(row.amount_usdc).toBeNull();
    expect(row.reason_codes).toEqual(
      expect.arrayContaining(["payer_unavailable", "amount_unavailable", "payee_unavailable"]),
    );
  });
});
