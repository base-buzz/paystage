import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_KIND,
  issueLifecycle,
  receiptDigest,
  refund,
  verifyChain,
  verifyLifecycleEvent,
  verifyReceipt,
  type ReceiptLike,
} from "../src/index.js";

/**
 * Offline: keys are generated in-process, no network, no fixtures. The statement signer is exercised
 * with a CryptoKey seam; production callers use the PKCS#8 path shared with receipts.
 */

/** An independent canonicalisation, so a drift in the package's copy is not hidden by using it to sign. */
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

async function keypair(kid = "k-lifecycle") {
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
  amount: "1000000",
  payee: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
};

const ISSUED = "2026-11-20T12:00:00.000Z";
const AUTHORISED = "2026-11-20T11:55:00.000Z";
const AFTER = "2026-11-20T12:10:00.000Z";

function payload(overrides: Partial<ReceiptLike> = {}): ReceiptLike {
  return {
    v: 1,
    issuer: "paystage",
    issued_at: ISSUED,
    payment: PAYMENT,
    service: { name: "@paystage/hosted", version: "test" },
    verdict: { decision: "pay", reasons: [], summary: "Decision: pay." },
    request_sha256: "a".repeat(64),
    policy_sha256: "b".repeat(64),
    ...overrides,
  };
}

async function signedReceipt(
  privateKey: CryptoKey,
  kid: string,
  overrides: Partial<ReceiptLike> = {},
): Promise<ReceiptLike> {
  const body = payload(overrides);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(canonical(body)),
  );
  return { ...body, signed: true, alg: "ECDSA-P256-SHA256", key_id: kid, signature: base64Url(signature) };
}

async function fixture() {
  const keys = await keypair();
  const receipt = await signedReceipt(keys.privateKey, keys.jwk.kid as string);
  const options = { privateKey: keys.privateKey, kid: keys.jwk.kid as string };
  return { keys, receipt, options };
}

describe("@paystage/receipt-verify — receipt lifecycle", () => {
  it("settles, refunds partially, verifies both statements and the arithmetic", async () => {
    const { keys, receipt, options } = await fixture();

    // The existing verifier still accepts the untouched receipt: no lifecycle field was added.
    await expect(verifyReceipt(receipt, { jwk: keys.jwk })).resolves.toMatchObject({
      ok: true,
      status: "signed-and-valid",
    });

    const authorised = await issueLifecycle(
      receipt,
      { state: "authorised", at: AUTHORISED },
      options,
    );
    const captured = await issueLifecycle(
      receipt,
      { state: "captured", amount: "1000000", at: ISSUED },
      options,
    );
    const partial = await refund(receipt, { amount: "400000", reason: "partial delivery", at: AFTER }, options);

    expect(authorised).toMatchObject({ v: 1, kind: LIFECYCLE_KIND, state: "authorised", signed: true });
    expect(partial.receipt).toBe(await receiptDigest(receipt));

    // "verify both": the receipt and the refund statement each verify on their own.
    await expect(verifyLifecycleEvent(partial, { jwk: keys.jwk })).resolves.toMatchObject({ ok: true });

    const chain = await verifyChain({ receipt }, [authorised, captured, partial], { jwk: keys.jwk });
    expect(chain).toEqual({
      ok: true,
      captured: "1000000",
      refunded: "400000",
      remaining: "600000",
      state: "refunded",
    });
  });

  it("refuses a refund larger than the captured amount", async () => {
    const { keys, receipt, options } = await fixture();
    const over = await refund(receipt, { amount: "1000001", at: AFTER }, options);

    const chain = await verifyChain({ receipt }, [over], { jwk: keys.jwk });
    expect(chain).toMatchObject({ ok: false, status: "amount-exceeds-captured", link: 0 });
  });

  it("refuses a refund larger than what remains after a partial refund", async () => {
    const { keys, receipt, options } = await fixture();
    const partial = await refund(receipt, { amount: "400000", at: AFTER }, options);
    const over = await refund(receipt, { amount: "600001", at: AFTER }, options);

    const chain = await verifyChain({ receipt }, [partial, over], { jwk: keys.jwk });
    expect(chain).toMatchObject({ ok: false, status: "amount-exceeds-captured", link: 1 });
  });

  it("refuses a second full refund", async () => {
    const { keys, receipt, options } = await fixture();
    const first = await refund(receipt, { amount: "1000000", at: AFTER }, options);
    const second = await refund(receipt, { amount: "1000000", at: "2026-11-20T12:20:00.000Z" }, options);

    const chain = await verifyChain({ receipt }, [first, second], { jwk: keys.jwk });
    expect(chain).toMatchObject({ ok: false, status: "already-refunded", link: 1 });
  });

  it("refuses voided after refunded", async () => {
    const { keys, receipt, options } = await fixture();
    const money = await refund(receipt, { amount: "400000", at: AFTER }, options);
    const voided = await issueLifecycle(receipt, { state: "voided", at: "2026-11-20T12:20:00.000Z" }, options);

    const chain = await verifyChain({ receipt }, [money, voided], { jwk: keys.jwk });
    expect(chain).toMatchObject({ ok: false, status: "illegal-transition", link: 1 });
    if (!chain.ok) expect(chain.reason).toContain("voided cannot follow refunded");
  });

  it("refuses a refund that precedes the capture", async () => {
    const { keys, receipt, options } = await fixture();
    const early = await refund(receipt, { amount: "100000", at: "2026-11-20T11:59:00.000Z" }, options);

    const chain = await verifyChain({ receipt }, [early], { jwk: keys.jwk });
    expect(chain).toMatchObject({ ok: false, status: "illegal-transition", link: 0 });
    if (!chain.ok) expect(chain.reason).toContain("a refund cannot precede a capture");
  });

  it("refuses an authorisation issued after the receipt captured", async () => {
    const { keys, receipt, options } = await fixture();
    const late = await issueLifecycle(receipt, { state: "authorised", at: AFTER }, options);

    const chain = await verifyChain({ receipt }, [late], { jwk: keys.jwk });
    expect(chain).toMatchObject({ ok: false, status: "illegal-transition", link: 0 });
  });

  it("lets a receipt with no lifecycle verify, and reports the untouched arithmetic", async () => {
    const { keys, receipt } = await fixture();

    await expect(verifyReceipt(receipt, { jwk: keys.jwk })).resolves.toMatchObject({ ok: true });
    await expect(verifyChain({ receipt }, [], { jwk: keys.jwk })).resolves.toEqual({
      ok: true,
      captured: "1000000",
      refunded: "0",
      remaining: "1000000",
      state: "captured",
    });
  });

  it("refuses an unsigned statement", async () => {
    const { keys, receipt, options } = await fixture();
    const signed = await refund(receipt, { amount: "100000", at: AFTER }, options);
    const { signature: _signature, ...rest } = signed;
    const unsigned = { ...rest, signed: false };

    await expect(verifyLifecycleEvent(unsigned, { jwk: keys.jwk })).resolves.toMatchObject({
      ok: false,
      status: "unsigned",
    });
    await expect(verifyChain({ receipt }, [unsigned], { jwk: keys.jwk })).resolves.toMatchObject({
      ok: false,
      status: "unsigned",
      link: 0,
    });
  });

  it("refuses a statement altered after signing", async () => {
    const { keys, receipt, options } = await fixture();
    const signed = await refund(receipt, { amount: "100000", at: AFTER }, options);
    const tampered = { ...signed, amount: "1" };

    await expect(verifyLifecycleEvent(tampered, { jwk: keys.jwk })).resolves.toMatchObject({
      ok: false,
      status: "tampered",
    });
    await expect(verifyChain({ receipt }, [tampered], { jwk: keys.jwk })).resolves.toMatchObject({
      ok: false,
      status: "tampered",
      link: 0,
    });
  });

  it("refuses a refund that points at a different receipt", async () => {
    const { keys, receipt, options } = await fixture();
    const other = await signedReceipt(keys.privateKey, keys.jwk.kid as string, {
      request_sha256: "c".repeat(64),
    });
    const elsewhere = await refund(other, { amount: "100000", at: AFTER }, options);

    await expect(verifyChain({ receipt }, [elsewhere], { jwk: keys.jwk })).resolves.toMatchObject({
      ok: false,
      status: "missing-original",
      link: 0,
    });
  });

  it("allows voided → refunded and accumulates several partial refunds", async () => {
    const { keys, receipt, options } = await fixture();
    const voided = await issueLifecycle(receipt, { state: "voided", at: AFTER }, options);
    const first = await refund(receipt, { amount: "250000", at: "2026-11-20T12:20:00.000Z" }, options);
    const second = await refund(receipt, { amount: "250000", at: "2026-11-20T12:30:00.000Z" }, options);

    await expect(verifyChain({ receipt }, [voided, first, second], { jwk: keys.jwk })).resolves.toEqual({
      ok: true,
      captured: "1000000",
      refunded: "500000",
      remaining: "500000",
      state: "refunded",
    });
  });

  it("checks a refund after the decision TTL without reading the settled payment as expired", async () => {
    const keys = await keypair();
    const receipt = await signedReceipt(keys.privateKey, keys.jwk.kid as string, {
      expires_at: "2026-11-20T12:05:00.000Z",
    });
    const options = { privateKey: keys.privateKey, kid: keys.jwk.kid as string };
    const money = await refund(receipt, { amount: "400000", at: AFTER }, options);

    // Acting on the decision this late is refused: that is what `expires_at` is for.
    await expect(
      verifyReceipt(receipt, { jwk: keys.jwk, now: new Date("2026-11-25T00:00:00.000Z") }),
    ).resolves.toMatchObject({ ok: false, status: "expired" });

    // But the payment settled, so an honest refund is still checkable — authenticity, not freshness.
    await expect(verifyChain({ receipt }, [money], { jwk: keys.jwk })).resolves.toMatchObject({
      ok: true,
      captured: "1000000",
      refunded: "400000",
      remaining: "600000",
    });
  });
});
