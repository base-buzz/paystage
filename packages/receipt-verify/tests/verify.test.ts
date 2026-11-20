import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyReceipt } from "../src/index.js";
import type { ReceiptLike } from "../src/index.js";

/**
 * Offline tests. Every key is generated in-process and every JWKS response is a
 * stub, so nothing here touches the network or imports the server.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** An independent canonicalisation, so a drift in the verifier's copy is not hidden by using it to sign. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function keypair(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<string, unknown>;
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid, use: "sig", alg: "ES256" } };
}

const PAYMENT = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "1000",
  payee: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
};

function payload(overrides: Partial<ReceiptLike> = {}): ReceiptLike {
  return {
    v: 1,
    issuer: "paystage",
    issued_at: "2026-11-20T12:00:00.000Z",
    expires_at: "2026-11-20T12:05:00.000Z",
    payment: PAYMENT,
    service: { name: "@paystage/hosted", version: "test" },
    verdict: { decision: "pay", reasons: [], summary: "Decision: pay." },
    request_sha256: "a".repeat(64),
    policy_sha256: "b".repeat(64),
    ...overrides,
  };
}

async function sign(body: ReceiptLike, pair: { privateKey: CryptoKey }, kid: string): Promise<ReceiptLike> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(canonical(body)),
  );
  return { ...body, signed: true, alg: "ECDSA-P256-SHA256", key_id: kid, signature: base64Url(signature) };
}

function jwks(keys: unknown[]) {
  return (async () => new Response(JSON.stringify({ keys, configured: true }), { status: 200 })) as unknown as typeof fetch;
}

const NOW = new Date("2026-11-20T12:01:00.000Z");

describe("@paystage/receipt-verify", () => {
  it("verifies a receipt signed by a generated throwaway key against a stubbed JWKS", async () => {
    const other = await keypair("k-new");
    const signer = await keypair("k-throwaway");
    const receipt = await sign(payload(), signer, "k-throwaway");

    // The receipt names the second key, so selection by kid is what makes this pass.
    const result = await verifyReceipt(receipt, {
      keyUrl: "https://issuer.test/.well-known/paystage-receipt-key.json",
      fetchImpl: jwks([other.jwk, signer.jwk]),
      payment: PAYMENT,
      now: NOW,
    });

    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      status: "signed-and-valid",
      verdict: "pay",
      key_id: "k-throwaway",
      key_source: "supplied",
    });
  });

  it("fails a tampered receipt", async () => {
    const signer = await keypair("k-throwaway");
    const receipt = await sign(payload(), signer, "k-throwaway");
    const tampered = { ...receipt, verdict: { ...receipt.verdict, decision: "do_not_pay" } };

    const result = await verifyReceipt(tampered, {
      keyUrl: "https://issuer.test/.well-known/paystage-receipt-key.json",
      fetchImpl: jwks([signer.jwk]),
      payment: PAYMENT,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, status: "invalid" });
    if (!result.ok) expect(result.reason).toMatch(/signature does not match/);
  });

  it("fails closed on an unknown kid", async () => {
    const signer = await keypair("k-throwaway");
    const published = await keypair("k-new");
    const receipt = await sign(payload(), signer, "k-revoked");

    const result = await verifyReceipt(receipt, {
      keyUrl: "https://issuer.test/.well-known/paystage-receipt-key.json",
      fetchImpl: jwks([published.jwk]),
      payment: PAYMENT,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, status: "unverifiable" });
    if (!result.ok) expect(result.reason).toMatch(/no key with kid k-revoked/);
  });

  it("fails an expired receipt with the expired status", async () => {
    const signer = await keypair("k-throwaway");
    const receipt = await sign(
      payload({
        issued_at: "2026-11-20T10:00:00.000Z",
        expires_at: "2026-11-20T10:05:00.000Z",
      }),
      signer,
      "k-throwaway",
    );

    const result = await verifyReceipt(receipt, {
      keyUrl: "https://issuer.test/.well-known/paystage-receipt-key.json",
      fetchImpl: jwks([signer.jwk]),
      payment: PAYMENT,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, status: "expired", expires_at: "2026-11-20T10:05:00.000Z" });
    if (!result.ok && result.status === "expired") expect(result.expired_by_seconds).toBeGreaterThan(0);
  });

  it("verifies an actual receipt from the live hosted endpoint with only the receipt and a fetch", async () => {
    // Captured from https://api.paystage.xyz/v1/evaluate_mcp_payment on 2026-11-20; the JWKS is the
    // published set at the same time. The clock is pinned to just after issue so the 300s lifetime is
    // honest, and the JWKS is served by a stub so the test stays offline.
    const live = JSON.parse(readFileSync(join(HERE, "fixtures/live-receipt.json"), "utf8")) as ReceiptLike;
    const liveJwks = JSON.parse(readFileSync(join(HERE, "fixtures/live-jwks.json"), "utf8")) as { keys: unknown[] };

    const result = await verifyReceipt(live, {
      keyUrl: "https://api.paystage.xyz/.well-known/paystage-receipt-key.json",
      fetchImpl: jwks(liveJwks.keys),
      payment: live.payment,
      now: new Date("2026-11-20T13:48:14.000Z"),
    });

    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      status: "signed-and-valid",
      verdict: "pay",
      key_id: "paystage-receipt-v1",
      key_source: "supplied",
    });
  });
});
