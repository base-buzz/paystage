import { describe, it, expect } from "vitest";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { buildReceipt } from "../src/receipt.js";
import { verifyReceipt } from "../../../packages/mcp/src/verify.js";

/**
 * Rotation is implemented and was never exercised (#314).
 *
 * `RECEIPT_SIGNING_KEYS_RETIRED` keeps old keys in the published JWKS so an unexpired receipt still verifies after a rotation, and the verifier selects an
 * entry by the `key_id` the receipt carries. Both halves are asserted here, plus the failure that matters: a receipt naming a key the issuer no longer
 * publishes must be `unverifiable`, never a guess at which key was meant.
 */
const key = () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString() as string;
};

const pkcs8B64 = (pem: string) =>
  Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64").toString("base64");

const decision = { decision: "pay", reasons: ["amount within policy"] };
const request = { x402Version: 2, accepts: [] };
const policy = { version: 1 };

// Signed "now" with a ten-minute life: a fixed past instant would be expired by the time the verifier reads it, and the expiry check runs after the signature.
const sign = async (kid: string, pem: string) =>
  buildReceipt({ decision, request, policy, now: new Date(), ttlSeconds: 600, signingKeyPkcs8B64: pkcs8B64(pem), keyId: kid });

/** Both keys published, the old one retired — the state a rotation leaves behind. */
const jwksFor = (...keys: Array<{ kid: string; pem: string }>) => ({
  keys: keys.map(({ kid, pem }) => ({
    ...createPublicKey(pem).export({ format: "jwk" }),
    kid,
    use: "sig",
    alg: "ES256",
  })),
  configured: true,
  alg: "ECDSA-P256-SHA256",
});

const serve = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

describe("receipt key rotation", () => {
  it("a receipt signed by a retired key still verifies while the new key is active", async () => {
    const oldPem = key();
    const newPem = key();
    const oldReceipt = await sign("k-old", oldPem);
    const newReceipt = await sign("k-new", newPem);

    // The old key is retired but still published: that is the whole point of KEYS_RETIRED.
    const jwks = jwksFor({ kid: "k-new", pem: newPem }, { kid: "k-old", pem: oldPem });
    const fetchImpl = serve(jwks) as never;

    const oldVerdict = await verifyReceipt(oldReceipt as never, { fetchImpl, keyUrl: "https://example.test/keys" });
    const newVerdict = await verifyReceipt(newReceipt as never, { fetchImpl, keyUrl: "https://example.test/keys" });

    expect(oldReceipt.key_id).toBe("k-old");
    expect(oldVerdict.status).toBe("signed-and-valid");
    expect(newVerdict.status).toBe("signed-and-valid");
  });

  it("fails closed when the receipt names a key the issuer does not publish", async () => {
    const newPem = key();
    const orphanReceipt = await sign("k-removed", key());

    const jwks = jwksFor({ kid: "k-new", pem: newPem });
    const verdict = await verifyReceipt(orphanReceipt as never, {
      fetchImpl: serve(jwks) as never,
      keyUrl: "https://example.test/keys",
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe("unverifiable");
    expect(verdict.reason).toMatch(/no key with kid k-removed/);
  });

  it("this test would notice if the retired key were dropped from the set", async () => {
    const oldPem = key();
    const newPem = key();
    const oldReceipt = await sign("k-old", oldPem);

    // The failure the rotation path prevents: only the new key published.
    const jwks = jwksFor({ kid: "k-new", pem: newPem });
    const verdict = await verifyReceipt(oldReceipt as never, {
      fetchImpl: serve(jwks) as never,
      keyUrl: "https://example.test/keys",
    });

    expect(verdict.status).toBe("unverifiable");
  });
});
