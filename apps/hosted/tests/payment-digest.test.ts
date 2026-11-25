import { describe, expect, it } from "vitest";
import { paymentTermsDigest } from "@paystage/preflight";
import { buildReceipt, publicKeyJwk, verifyReceipt, type ReceiptPayment } from "../src/receipt.js";

/**
 * #443: the gate emits the digest of the payment it approved, and the signer adapter refuses unless
 * the receipt carries it. These tests pin the builder's half of that contract: stable for one
 * challenge, different for a different amount, and honest (absent) when the terms cannot be hashed.
 */

const payment: ReceiptPayment = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "2000",
  payee: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
};
const decision = { decision: "pay" as const, reasons: [] };
const request = {
  x402Version: 2,
  accepts: [{ ...payment, payTo: payment.payee, maxTimeoutSeconds: 300 }],
};
const policy = { version: 1 };
const AT = new Date("2026-11-25T12:00:00.000Z");

async function makeKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  return btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
}

const build = (overrides: Partial<Parameters<typeof buildReceipt>[0]> = {}) =>
  buildReceipt({ decision, request, policy, now: AT, ...overrides });

describe("receipt payment_digest (#443)", () => {
  it("carries a stable digest for the same challenge", async () => {
    const a = await build({ payment });
    const b = await build({ payment });
    expect(a.payment_digest).toBeDefined();
    expect(a.payment_digest).toBe(b.payment_digest);
    expect(a.payment_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("emits the shared payment-terms digest, lowercase hex without 0x", async () => {
    const receipt = await build({ payment });
    expect(receipt.payment_digest).toBe(await paymentTermsDigest(payment));
    expect(receipt.payment_digest?.startsWith("0x")).toBe(false);
  });

  it("yields a different digest for a different amount", async () => {
    const cheap = await build({ payment });
    const dear = await build({ payment: { ...payment, amount: "2001" } });
    expect(cheap.payment_digest).not.toBe(dear.payment_digest);
  });

  it("omits the field rather than inventing one when the terms cannot be hashed", async () => {
    const malformed = await build({ payment: { ...payment, amount: "not-atomic" } });
    expect(malformed.payment).toBeDefined();
    expect(malformed.payment_digest).toBeUndefined();
    // The verdict still exists: accounting failure must not withhold a decision.
    expect(malformed.verdict.decision).toBe("pay");
  });

  it("signs the digest into the payload, so altering it breaks verification", async () => {
    const key = await makeKey();
    const receipt = await build({ payment, signingKeyPkcs8B64: key, ttlSeconds: 0 });
    const jwk = await publicKeyJwk(key);
    expect(await verifyReceipt(receipt, jwk!)).toBe("valid");

    const tampered = { ...receipt, payment_digest: "0".repeat(64) };
    expect(await verifyReceipt(tampered, jwk!)).toBe("invalid");
  });

  it("still builds and verifies a receipt when no payment terms are known", async () => {
    const key = await makeKey();
    const receipt = await build({ signingKeyPkcs8B64: key, ttlSeconds: 0 });
    expect(receipt.payment).toBeUndefined();
    expect(receipt.payment_digest).toBeUndefined();
    expect(await verifyReceipt(receipt, (await publicKeyJwk(key))!)).toBe("valid");
  });
});
