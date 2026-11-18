import { describe, expect, it } from "vitest";
import { buildReceipt } from "../../../apps/hosted/src/receipt.js";
import { verifyReceipt } from "../src/verify.js";

/**
 * #42 — a key SET, not one key.
 *
 * One published key makes rotation a breaking change: publish a new key and every receipt signed before it stops
 * verifying. These tests hold the property that makes rotation additive — a receipt keeps verifying after a new key
 * is published, because the receipt names the key that signed it and the verifier chooses by that name.
 */

async function keypair() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { b64: Buffer.from(new Uint8Array(pkcs8)).toString("base64"), jwk: { ...jwk, kid: "k-old", use: "sig", alg: "ES256" } };
}

describe("JWKS verification", () => {
  it("verifies a receipt signed by an older key after a new key is published", async () => {
    const old = await keypair();
    const fresh = await keypair();
    const receipt = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: {},
      policy: {},
      signingKeyPkcs8B64: old.b64,
      keyId: "k-old",
    });
    // The issuer rotates: both keys are published, the new one first.
    const body = { keys: [{ ...fresh.jwk, kid: "k-new" }, old.jwk] };
    const result = await verifyReceipt(receipt as never, {
      keyUrl: "https://issuer/.well-known/paystage-receipt-key.json",
      fetchImpl: (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("refuses rather than guessing when the receipt names a key the issuer does not publish", async () => {
    const fresh = await keypair();
    const other = await keypair();
    const receipt = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: {},
      policy: {},
      signingKeyPkcs8B64: other.b64,
      keyId: "k-revoked",
    });
    const result = await verifyReceipt(receipt as never, {
      keyUrl: "https://issuer/.well-known/paystage-receipt-key.json",
      fetchImpl: (async () => new Response(JSON.stringify({ keys: [fresh.jwk] }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("unverifiable");
      expect(result.reason).toMatch(/no key with kid k-revoked/);
    }
  });

  it("still reads the older single-key shape", async () => {
    const key = await keypair();
    const receipt = await buildReceipt({
      decision: { decision: "review", reasons: ["x"] },
      request: {},
      policy: {},
      signingKeyPkcs8B64: key.b64,
      keyId: "k-old",
    });
    const result = await verifyReceipt(receipt as never, {
      keyUrl: "https://issuer/v1/public/receipt-key.json",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ configured: true, jwk: key.jwk }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});
