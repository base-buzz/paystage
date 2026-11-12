import { describe, expect, it } from "vitest";
import {
  buildReceipt,
  canonicalize,
  sha256Hex,
  verifyReceipt,
  publicKeyJwk,
  type Receipt,
} from "../src/receipt.js";

/** Generate a throwaway P-256 key and return its PKCS#8 base64. */
async function makeKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  return btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
}

const decision = { decision: "do_not_pay", reasons: ["payTo is a known drainer"], summary: "denied" };
const policy = { version: 1, allowed_networks: ["eip155:8453"] };
const request = { scheme: "exact", network: "eip155:8453", payTo: "0xabc", amount: "1000" };

describe("canonicalize", () => {
  it("is insensitive to key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("is stable for nested structures", () => {
    const a = { z: [{ y: 1, x: 2 }], a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, z: [{ x: 2, y: 1 }] };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"c":3,"d":4},"z":[{"x":2,"y":1}]}');
  });

  it("drops undefined members rather than emitting them", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("sha256Hex", () => {
  it("is deterministic across key order", async () => {
    expect(await sha256Hex({ a: 1, b: 2 })).toBe(await sha256Hex({ b: 2, a: 1 }));
  });

  it("changes when the policy changes", async () => {
    const a = await sha256Hex({ max: "1.00" });
    const b = await sha256Hex({ max: "2.00" });
    expect(a).not.toBe(b);
  });
});

describe("buildReceipt", () => {
  it("emits an unsigned receipt when no key is configured", async () => {
    const r = await buildReceipt({ decision, request, policy });
    expect(r.signed).toBe(false);
    expect(r.signature).toBeUndefined();
    expect(r.verdict.decision).toBe("do_not_pay");
    expect(r.request_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.policy_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not alter the decision it wraps", async () => {
    const r = await buildReceipt({ decision, request, policy });
    expect(r.verdict).toEqual({
      decision: decision.decision,
      reasons: decision.reasons,
      summary: decision.summary,
    });
  });

  it("signs and verifies when a key is configured", async () => {
    const key = await makeKey();
    const r = await buildReceipt({ decision, request, policy, signingKeyPkcs8B64: key });
    expect(r.signed).toBe(true);
    expect(r.signature).toBeTruthy();

    const jwk = await publicKeyJwk(key);
    expect(jwk).toBeDefined();
    expect(await verifyReceipt(r, jwk!)).toBe("valid");
  });

  it("fails verification when the verdict is tampered with", async () => {
    const key = await makeKey();
    const r = await buildReceipt({ decision, request, policy, signingKeyPkcs8B64: key });
    const jwk = await publicKeyJwk(key);

    const tampered: Receipt = {
      ...r,
      verdict: { ...r.verdict, decision: "pay" },
    };
    expect(await verifyReceipt(tampered, jwk!)).toBe("invalid");
  });

  it("reports that a signed receipt is unsigned if the signature is stripped", async () => {
    const key = await makeKey();
    const r = await buildReceipt({ decision, request, policy, signingKeyPkcs8B64: key });
    const stripped: Receipt = { ...r, signed: false, signature: undefined };
    const jwk = await publicKeyJwk(key);
    expect(await verifyReceipt(stripped, jwk!)).toBe("unsigned");
  });

  it("degrades to unsigned rather than failing on a malformed key", async () => {
    const r = await buildReceipt({
      decision,
      request,
      policy,
      signingKeyPkcs8B64: "not-a-real-key",
    });
    expect(r.signed).toBe(false);
  });
});

/**
 * Golden anchors — the check Worker-2 proposed after finding the spec had drifted from the
 * code.
 *
 * The only place a digest *value* was pinned was `docs/specs/receipt-spec.md`, which is
 * exactly the file that went stale: it advertised `service.version 0.3.4` for a field that
 * emitted `0.0.0`, and nothing failed. Pinning two real digests here makes the document and
 * the implementation fail together instead of disagreeing quietly.
 *
 * If one of these breaks, the canonical form or a digest changed. That is a format change:
 * update the spec in the same commit, or explain why the format moved.
 */
describe("golden receipts", () => {
  const vector1Request = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "2000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
        maxTimeoutSeconds: 300,
      },
    ],
  };
  const vector1Policy = {
    version: 1,
    max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
    allowed_pay_to: ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
    allowed_networks: ["eip155:8453"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  };
  const vector2Request = {
    ...vector1Request,
    accepts: [{ ...vector1Request.accepts[0], payTo: "0x1111111111111111111111111111111111111111" }],
  };
  const at = new Date("2026-11-12T00:00:00.000Z");

  it("vector 1 matches the digests published in docs/specs/receipt-spec.md", async () => {
    const r = await buildReceipt({
      decision: { decision: "pay", reasons: [], summary: "Decision: pay." },
      request: vector1Request,
      policy: vector1Policy,
      now: at,
    });
    expect(r.request_sha256).toBe("37172a4ff969ab46b7b4ef4735c7f41b9f10740f3821faf7a67b2bdf9342ff2f");
    expect(r.policy_sha256).toBe("49f9c17bea2410e4a187ca1593cbdd4a5ff8e260fd280f44c10114d52fcf7bfb");
  });

  it("vector 2 changes only the request digest, because only the request changed", async () => {
    const r = await buildReceipt({
      decision: { decision: "do_not_pay", reasons: ["payTo not in allowed_pay_to"], summary: "denied" },
      request: vector2Request,
      policy: vector1Policy,
      now: at,
    });
    expect(r.request_sha256).toBe("480300b1712bb50c30c8c89803cbf17a4ccc9d28193741612586ac1163e2a6ee");
    expect(r.policy_sha256).toBe("49f9c17bea2410e4a187ca1593cbdd4a5ff8e260fd280f44c10114d52fcf7bfb");
  });
});

/**
 * The fields the payload carries but nothing asserted. `service.name` and `v` are the ones
 * that matter: a rename or a version bump changes what every receipt means while all the
 * other tests stay green.
 */
describe("payload fields that were unobserved", () => {
  const at = new Date("2026-11-12T00:00:00.000Z");
  const build = () =>
    buildReceipt({ decision: { decision: "pay", reasons: [] }, request: {}, policy: {}, now: at });

  it("pins the format version at 1, not at whatever the constant says", async () => {
    const r = await build();
    // The literal is deliberate: asserting `v === RECEIPT_VERSION` alone would move with the
    // code and never fail when the format changes.
    expect(r.v).toBe(1);
  });

  it("names the issuer and the service, so a rename cannot pass silently", async () => {
    const r = await build();
    expect(r.issuer).toBe("paystage");
    expect(r.service.name).toBe("@paystage/hosted");
  });

  it("is deterministic for a pinned clock — the header's second stated constraint", async () => {
    const a = await build();
    const b = await build();
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(a.issued_at).toBe(at.toISOString());
  });

  it("carries alg and key_id values a verifier can trust on a signed receipt", async () => {
    const r = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: {},
      policy: {},
      now: at,
      signingKeyPkcs8B64: await makeKey(),
    });
    expect(r.signed).toBe(true);
    expect(r.alg).toBe("ECDSA-P256-SHA256");
    expect(r.key_id).toBe("paystage-receipt-v1");
  });
});
