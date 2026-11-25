import { describe, expect, it } from "vitest";
import {
  PAYMENT_DIGEST_DOMAIN,
  canonicalPaymentTerms,
  paymentTermsDigest,
} from "../src/payment-digest.js";

/**
 * #443. The digest is the one value the gate signs and the signer adapter recomputes; both sides
 * import this function rather than describing the rule twice. These tests pin the rule itself.
 */

const terms = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "2000",
  payee: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
};

describe("paymentTermsDigest (#443)", () => {
  it("is stable for the same payment terms", async () => {
    expect(await paymentTermsDigest(terms)).toBe(await paymentTermsDigest({ ...terms }));
  });

  it("is lowercase 64-hex without 0x, the shape the receipt field uses", async () => {
    const digest = await paymentTermsDigest(terms);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("0x");
  });

  it("changes when the amount changes", async () => {
    expect(await paymentTermsDigest({ ...terms, amount: "2001" })).not.toBe(
      await paymentTermsDigest(terms),
    );
  });

  it("changes for each bound term: payee, asset, network and scheme", async () => {
    const base = await paymentTermsDigest(terms);
    for (const change of [
      { payee: "0x1111111111111111111111111111111111111111" },
      { asset: "0x0000000000000000000000000000000000000001" },
      { network: "eip155:84532" },
      { scheme: "upto" },
    ]) {
      expect(await paymentTermsDigest({ ...terms, ...change })).not.toBe(base);
    }
  });

  it("normalises address casing, network casing and atomic amount spelling", async () => {
    expect(
      await paymentTermsDigest({
        scheme: "EXACT",
        network: " EIP155:8453 ",
        asset: terms.asset.toLowerCase(),
        amount: "02000",
        payee: terms.payee.toLowerCase(),
      }),
    ).toBe(await paymentTermsDigest(terms));
  });

  it("hashes a domain-separated object, so the input is reproducible from the rule", async () => {
    const canonical = canonicalPaymentTerms(terms);
    expect(canonical).toEqual({
      domain: PAYMENT_DIGEST_DOMAIN,
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "2000",
      payee: "0x1b2272a2ca1792e8497a8d45fd3eb8665ae88fae",
    });
    // SHA-256 of the sorted-key canonical JSON; pinned so a canonicalisation change is a failure.
    const expected = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        '{"amount":"2000","asset":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","domain":"paystage.payment-terms.v1","network":"eip155:8453","payee":"0x1b2272a2ca1792e8497a8d45fd3eb8665ae88fae","scheme":"exact"}',
      ),
    );
    const hex = [...new Uint8Array(expected)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await paymentTermsDigest(terms)).toBe(hex);
  });

  it("refuses terms it cannot canonicalise rather than returning a fake digest", async () => {
    await expect(paymentTermsDigest({ ...terms, amount: "not-a-number" })).rejects.toThrow(/amount/);
    await expect(paymentTermsDigest({ ...terms, amount: "-1" })).rejects.toThrow(/amount/);
    await expect(paymentTermsDigest({ ...terms, payee: "" })).rejects.toThrow(/payee/);
  });
});
