import { describe, it, expect } from "vitest";
import { buildReceipt } from "../../../apps/hosted/src/receipt.js";
import { verifyReceipt } from "../src/verify.js";

async function keypair() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  const b64 = Buffer.from(new Uint8Array(pkcs8)).toString("base64");
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { b64, jwk };
}

describe("the gaps Worker-2 found", () => {
  it("key_id is not trusted — it is echoed, and provenance comes from the key used", async () => {
    const { b64, jwk } = await keypair();
    const r = await buildReceipt({ decision: { decision: "pay", reasons: [] }, request: {}, policy: {}, signingKeyPkcs8B64: b64, serviceVersion: "t" });
    const v = await verifyReceipt({ ...r, key_id: "someone-elses-key" }, { jwk: jwk as never });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.key_source).toBe("supplied");
  });

  it("rejects a receipt from a format version this verifier does not understand", async () => {
    const { b64, jwk } = await keypair();
    const r = await buildReceipt({ decision: { decision: "pay", reasons: [] }, request: {}, policy: {}, signingKeyPkcs8B64: b64 });
    const v = await verifyReceipt({ ...r, v: 999 }, { jwk: jwk as never });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/unsupported receipt version/);
  });

  it("rejects an unknown verdict value rather than passing it through", async () => {
    const { b64, jwk } = await keypair();
    const r = await buildReceipt({ decision: { decision: "pay", reasons: [] }, request: {}, policy: {}, signingKeyPkcs8B64: b64 });
    const v = await verifyReceipt({ ...r, verdict: { decision: "definitely-fine" } }, { jwk: jwk as never });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/unknown verdict/);
  });

  it("still accepts a genuine receipt", async () => {
    const { b64, jwk } = await keypair();
    const r = await buildReceipt({ decision: { decision: "do_not_pay", reasons: ["x"] }, request: {}, policy: {}, signingKeyPkcs8B64: b64 });
    const v = await verifyReceipt(r, { jwk: jwk as never });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.verdict).toBe("do_not_pay");
  });
});
