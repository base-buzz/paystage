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
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
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
