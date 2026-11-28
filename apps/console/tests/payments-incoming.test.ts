import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PricingPage from "@/app/pricing/page";
import { INCOMING, assertClassified, formatSentence, type IncomingSnapshot } from "@/lib/payments-incoming";

/**
 * The pricing page is where a reader asks whether anyone has paid us (#490). These tests pin the measured
 * numbers to the committed snapshot, and fail when a payer appears without a classification.
 *
 * The numbers are deliberately literal. A regenerated snapshot with a different result should make this test
 * fail until someone acknowledges the change — that is the difference between a claim and a measurement.
 */
const EXPECTED = {
  transfers: 205,
  ours: 205,
  external: 0,
  unknown: 0,
  amountUsdc: "0.410000",
  days: 30,
  fromBlock: 53_222_129,
  toBlock: 63_176_146,
  generatedOn: "2026-11-28",
};

const html = renderToStaticMarkup(createElement(PricingPage));

describe("incoming payments snapshot", () => {
  it("pins the measured counts, total and window", () => {
    expect(INCOMING.counts.transfers).toBe(EXPECTED.transfers);
    expect(INCOMING.counts.ours).toBe(EXPECTED.ours);
    expect(INCOMING.counts.external).toBe(EXPECTED.external);
    expect(INCOMING.counts.unknown).toBe(EXPECTED.unknown);
    expect(INCOMING.counts.transfers).toBe(INCOMING.counts.ours + INCOMING.counts.external + INCOMING.counts.unknown);
    expect(INCOMING.totals.amountUsdc).toBe(EXPECTED.amountUsdc);
    expect(INCOMING.window.days).toBe(EXPECTED.days);
    expect(INCOMING.window.fromBlock).toBe(EXPECTED.fromBlock);
    expect(INCOMING.window.toBlock).toBe(EXPECTED.toBlock);
    expect(INCOMING.generatedAt.startsWith(EXPECTED.generatedOn)).toBe(true);
  });

  it("shows no external payment yet, and says 'none' rather than inventing a date", () => {
    expect(INCOMING.lastExternal).toBeNull();
    expect(formatSentence()).toBe(
      "205 transfers to our payee in the last 30 days: 205 ours, 0 external, 0 unknown. Last external payment: none.",
    );
  });

  it("contains the 0.002000 USDC transfer that prompted the row, from a named wallet of ours", () => {
    const transfer = INCOMING.transfers.find((row) => row.block === 63_085_963);
    expect(transfer).toBeDefined();
    expect(transfer).toMatchObject({
      tx: "0xa6faea6ccb4362e59b9a8227953988041c699cd2195dbf139276319aa9084cf3",
      at: "2026-11-27T19:26:08.000Z",
      payer: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
      bucket: "ours",
      amountAtomic: "2000",
      amountUsdc: "0.002000",
    });
  });

  it("classifies every transfer against the published list", () => {
    expect(() => assertClassified(INCOMING)).not.toThrow();
    for (const transfer of INCOMING.transfers) {
      expect(["ours", "external", "unknown"]).toContain(transfer.bucket);
      expect(transfer.payer).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it("fails when an unclassified payer appears", () => {
    const unclassified = JSON.parse(JSON.stringify(INCOMING)) as IncomingSnapshot;
    unclassified.transfers[0].bucket = "guessed" as IncomingSnapshot["transfers"][number]["bucket"];
    expect(() => assertClassified(unclassified)).toThrow(/unclassified bucket/);

    const mismatched = JSON.parse(JSON.stringify(INCOMING)) as IncomingSnapshot;
    mismatched.transfers[0].payer = "0x000000000000000000000000000000000000dEaD";
    mismatched.transfers[0].bucket = "ours";
    expect(() => assertClassified(mismatched)).toThrow(/is external/);

    const unreadable = JSON.parse(JSON.stringify(INCOMING)) as IncomingSnapshot;
    unreadable.transfers[0].payer = null;
    unreadable.transfers[0].bucket = "external";
    expect(() => assertClassified(unreadable)).toThrow(/no payer/);
  });
});

describe("the pricing page states it, with the list visible", () => {
  it("renders the exact sentence from the classifier's output", () => {
    expect(html).toContain(formatSentence());
    expect(html).toContain("0 external");
    expect(html).toContain("Last external payment: none.");
  });

  it("puts the explorer consequence on the same page as the counts", () => {
    expect(html).toContain("tx_count");
    expect(html).toContain("quoting that number as demand would be quoting ourselves");
  });

  it("shows the addresses it treats as ours, so a reader can check the list", () => {
    for (const payer of INCOMING.knownPayers) {
      expect(html).toContain(payer.address);
    }
    expect(html).toContain("data/payments/known-payers.json");
  });
});
