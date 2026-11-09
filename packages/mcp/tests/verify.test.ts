import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { canonicalize, receiptPayload, verifyReceipt } from "../src/verify.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;

/** Mirrors apps/hosted/src/receipt.ts: payload canonicalised, raw r||s, base64url. */
function makeReceipt(overrides: Record<string, unknown> = {}) {
  const payload = {
    v: 1,
    issuer: "paystage",
    issued_at: "2026-11-10T00:00:00.000Z",
    service: { name: "@paystage/hosted", version: "0.1.0" },
    verdict: { decision: "do_not_pay", reasons: ["payTo is a known drainer"] },
    request_sha256: "a".repeat(64),
    policy_sha256: "b".repeat(64),
    ...overrides,
  };
  const signature = nodeSign("sha256", Buffer.from(canonicalize(payload), "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  })
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return {
    ...payload,
    signed: true,
    alg: "ECDSA-P256-SHA256",
    key_id: "paystage-receipt-v1",
    signature,
  };
}

describe("canonicalize", () => {
  it("sorts keys recursively and drops whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [3, 4] } })).toBe('{"a":{"c":[3,4],"d":2},"b":1}');
  });

  it("omits undefined values so an absent field cannot change the digest", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("receiptPayload", () => {
  it("strips exactly the signature fields", () => {
    const payload = receiptPayload({ ...makeReceipt(), signed: true, signature: "x" });
    expect(Object.keys(payload).sort()).toEqual([
      "issued_at",
      "issuer",
      "policy_sha256",
      "request_sha256",
      "service",
      "v",
      "verdict",
    ]);
  });
});

describe("verifyReceipt", () => {
  it("accepts a well-formed receipt", async () => {
    const result = await verifyReceipt(makeReceipt(), { jwk });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verdict).toBe("do_not_pay");
      expect(result.key_id).toBe("paystage-receipt-v1");
    }
  });

  it("rejects a tampered verdict", async () => {
    const receipt = makeReceipt();
    receipt.verdict = { decision: "pay", reasons: [] };
    const result = await verifyReceipt(receipt, { jwk });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("invalid");
  });

  it("rejects a receipt whose digest was altered after signing", async () => {
    // Sign normally, then mutate — rebuilding with a different digest would simply
    // produce a different valid signature, which is the mistake this test exists to
    // avoid making.
    const receipt = makeReceipt();
    receipt.request_sha256 = "c".repeat(64);
    const result = await verifyReceipt(receipt, { jwk });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("invalid");
  });

  it("reports unsigned receipts as unsigned, not invalid", async () => {
    const result = await verifyReceipt({ ...makeReceipt(), signed: false }, { jwk });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("unsigned");
  });

  it("reports an unpublished key as unverifiable, not invalid", async () => {
    const result = await verifyReceipt(makeReceipt(), {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ configured: false }), { status: 200 })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("unverifiable");
  });

  it("reports a key endpoint failure as unverifiable", async () => {
    const result = await verifyReceipt(makeReceipt(), {
      fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("unverifiable");
  });
});
