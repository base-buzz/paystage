import { describe, expect, it } from "vitest";

import { X402SCAN_LISTING, isListedOnX402Scan, x402ScanListingSentence, type X402ScanListing } from "@/lib/x402scan-listing";

/**
 * The listing block is conditional by construction (#484). Both states are tested against the **same function**, because a page that
 * renders a claim only when it is true is the whole point — and the copy has to be right on the day it first appears, which is a day
 * nobody will be editing it.
 *
 * The committed snapshot is real: today it says their index does not have us, so the first test is the one that currently runs.
 */
describe("x402scan listing", () => {
  const listed: X402ScanListing = {
    checkedAt: "2026-12-01T00:00:00.000Z",
    listedAt: "2026-12-01T00:00:00.000Z",
    anyListing: true,
    listed: { payeeInRecipients: true, facilitatorWalletInFacilitators: false },
  };

  it("renders nothing while their index does not have us", () => {
    const absent: X402ScanListing = { ...listed, anyListing: false, listedAt: null, listed: { payeeInRecipients: false, facilitatorWalletInFacilitators: false } };
    expect(isListedOnX402Scan(absent)).toBe(false);
    expect(x402ScanListingSentence(absent)).toBeNull();
  });

  it("names the date, what was observed, and what it does not mean", () => {
    const sentence = x402ScanListingSentence(listed);
    expect(sentence).toContain("2026-12-01");
    expect(sentence).toContain("recipient table");
    expect(sentence).toContain("not a customer");
    expect(sentence).toContain("not a claim about demand");
    expect(sentence).not.toContain("facilitator table"); // that half was false in this fixture
  });

  it("says nothing when listed but both observations are false", () => {
    const empty: X402ScanListing = { ...listed, listed: { payeeInRecipients: false, facilitatorWalletInFacilitators: false } };
    expect(x402ScanListingSentence(empty)).toBeNull();
  });

  it("matches the committed snapshot's own state", () => {
    expect(typeof X402SCAN_LISTING.anyListing).toBe("boolean");
    expect(X402SCAN_LISTING.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
