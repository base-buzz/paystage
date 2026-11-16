import { describe, it, expect } from "vitest";
import { buildReceipt, RECEIPT_TTL_SECONDS } from "../../../apps/hosted/src/receipt.js";
import { verifyReceipt } from "../src/verify.js";

const payment = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "2000",
  payee: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
};

async function signed(issued: string, opts: { ttlSeconds?: number; payment?: typeof payment } = {}) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const receipt = await buildReceipt({
    decision: { decision: "pay", reasons: [] },
    request: {},
    policy: {},
    signingKeyPkcs8B64: Buffer.from(new Uint8Array(pkcs8)).toString("base64"),
    now: new Date(issued),
    ...(opts.payment ? { payment: opts.payment } : {}),
    ...(opts.ttlSeconds === undefined ? {} : { ttlSeconds: opts.ttlSeconds }),
  });
  return { receipt, jwk };
}

describe("receipt lifetime", () => {
  it("stamps expiry five minutes after issue by default", async () => {
    const { receipt } = await signed("2026-11-16T10:00:00.000Z");
    expect(receipt.expires_at).toBe(new Date(Date.parse("2026-11-16T10:00:00.000Z") + RECEIPT_TTL_SECONDS * 1000).toISOString());
  });

  it("is valid inside the window and expired after it", async () => {
    const { receipt, jwk } = await signed("2026-11-16T10:00:00.000Z", { payment });
    const inside = await verifyReceipt(receipt, { jwk: jwk as never, now: new Date("2026-11-16T10:04:00.000Z") });
    expect(inside.ok).toBe(true);

    const out = await verifyReceipt(receipt, { jwk: jwk as never, now: new Date("2026-11-16T10:05:01.000Z") });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe("expired");
  });

  it("refuses a genuine receipt issued for a different payment", async () => {
    const { receipt, jwk } = await signed("2026-11-16T10:00:00.000Z", { payment });
    const out = await verifyReceipt(receipt, {
      jwk: jwk as never,
      now: new Date("2026-11-16T10:01:00.000Z"),
      // Same everything except the amount: 0.002 against 0.02
      payment: { ...payment, amount: "20000" },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe("payment-mismatch");
      if (out.status === "payment-mismatch") expect(out.mismatched).toContain("amount");
    }
  });

  it("accepts a receipt that matches the supplied payment", async () => {
    const { receipt, jwk } = await signed("2026-11-16T10:00:00.000Z", { payment });
    const out = await verifyReceipt(receipt, { jwk: jwk as never, now: new Date("2026-11-16T10:01:00.000Z"), payment });
    expect(out.ok).toBe(true);
  });

  it("says an unbound older receipt cannot be shown to be about this payment", async () => {
    const { receipt, jwk } = await signed("2026-11-16T10:00:00.000Z");
    const out = await verifyReceipt(receipt, { jwk: jwk as never, now: new Date("2026-11-16T10:01:00.000Z"), payment });
    expect(out.ok).toBe(false);
    if (!out.ok && out.status === "payment-mismatch") expect(out.mismatched).toContain("binding");
  });

  it("keeps old receipts working when no payment is supplied", async () => {
    const { receipt, jwk } = await signed("2026-11-16T10:00:00.000Z", { ttlSeconds: 0 });
    const out = await verifyReceipt(receipt, { jwk: jwk as never, now: new Date("2027-01-01T00:00:00.000Z") });
    expect(out.ok).toBe(true);
  });
});
