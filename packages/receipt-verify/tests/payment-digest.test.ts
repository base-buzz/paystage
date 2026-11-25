import { describe, expect, it } from "vitest";
import { buildReceipt } from "../../../apps/hosted/src/receipt.js";
import {
  canonicalize,
  normalizePaymentDigest,
  receiptPayload,
  verifyReceipt,
  type ReceiptLike,
} from "../src/index.js";

/**
 * #443: the verifier must accept a receipt that carries `payment_digest`, keep accepting receipts
 * issued before the field existed, and refuse a signed-but-malformed digest rather than treating it
 * as a weaker approval.
 */

const payment = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "2000",
  payee: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
};

async function keypair() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return {
    b64: Buffer.from(new Uint8Array(pkcs8)).toString("base64"),
    jwk: jwk as never,
    privateKey: pair.privateKey,
  };
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sign an arbitrary payload the way an issuer would, including a malformed digest. */
async function sign(receipt: ReceiptLike, privateKey: CryptoKey): Promise<ReceiptLike> {
  const body = receiptPayload(receipt);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(canonicalize(body)),
  );
  return { ...body, signed: true, alg: "ECDSA-P256-SHA256", key_id: "paystage-receipt-v1", signature: base64Url(signature) };
}

const at = new Date("2026-11-25T12:00:00.000Z");

describe("receipt-verify accepts payment_digest (#443)", () => {
  it("verifies a builder receipt that carries the field", async () => {
    const { b64, jwk } = await keypair();
    const receipt = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: { x402Version: 2, accepts: [] },
      policy: {},
      payment,
      signingKeyPkcs8B64: b64,
      ttlSeconds: 0,
      now: at,
    });
    expect(receipt.payment_digest).toMatch(/^[0-9a-f]{64}$/);
    const verdict = await verifyReceipt(receipt, { jwk });
    expect(verdict.ok).toBe(true);
  });

  it("still verifies a receipt issued without the field", async () => {
    const { b64, jwk } = await keypair();
    const receipt = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: {},
      policy: {},
      signingKeyPkcs8B64: b64,
      ttlSeconds: 0,
      now: at,
    });
    expect(receipt.payment_digest).toBeUndefined();
    const verdict = await verifyReceipt(receipt, { jwk });
    expect(verdict.ok).toBe(true);
  });

  it("refuses a signed receipt whose payment_digest is not 64-hex", async () => {
    const { b64, jwk, privateKey } = await keypair();
    const built = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: {},
      policy: {},
      payment,
      signingKeyPkcs8B64: b64,
      ttlSeconds: 0,
      now: at,
    });
    const malformed = await sign({ ...built, payment_digest: "not-a-digest" }, privateKey);
    const verdict = await verifyReceipt(malformed, { jwk });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.status).toBe("invalid");
      expect(verdict.reason).toMatch(/payment_digest/);
    }
  });

  it("normalises 0x-prefixed hex and rejects every other shape", () => {
    expect(normalizePaymentDigest("0x" + "a".repeat(64))).toBe("a".repeat(64));
    expect(normalizePaymentDigest("A".repeat(64))).toBe("a".repeat(64));
    expect(normalizePaymentDigest("0x1234")).toBeNull();
    expect(normalizePaymentDigest(64)).toBeNull();
    expect(normalizePaymentDigest(undefined)).toBeNull();
  });
});
