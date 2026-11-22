import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemandSourcesPanel } from "@/components/DemandSourcesPanel";
import {
  BAZAAR_DEMAND,
  bazaarComparisonNotice,
  bazaarSampleDefinition,
  walkedDemandDefinition,
  type BazaarDemandSnapshot,
} from "@/lib/bazaar-demand";
import {
  buildDemandView,
  type DemandView,
  type MarketDemandRow,
  type MarketSupplyRow,
} from "@/lib/market-demand";

/**
 * The two demand columns (#375).
 *
 * The guard these tests exist for is not "the numbers appear" — it is "the label and the sampling rule appear with the
 * number, and come from the data". The Bazaar note is mutated here so a component that retypes the label instead of
 * rendering the snapshot's `note` field fails, and a counter with no note is asserted to be withheld rather than shown.
 */

const NOW = Date.parse("2026-11-22T21:00:00Z");

const demandRow: MarketDemandRow = {
  run_date: "2026-11-22",
  window_blocks: 2000,
  chain_usdc_transfers: 16483,
  payee_transfers: 68,
  payee_transfers_value_usdc: 2.213012,
  distinct_payees_paid: 4,
  distinct_payers: 5,
  repeat_payers: 3,
  sampled_payees: 857,
  size_p50_usdc: 0.01,
  size_p90_usdc: 0.05,
  control_topic_filter: true,
  created_at: "2026-11-22T18:00:00Z",
};

const supplyRow: MarketSupplyRow = { run_date: "2026-11-22", payees: 1324 };

function readyView(): DemandView {
  return buildDemandView(
    { demand: { ok: true, rows: [demandRow] }, supply: { ok: true, rows: [supplyRow] } },
    NOW,
  );
}

const snapshotBase: BazaarDemandSnapshot = {
  measuredAt: "2026-11-22T20:49:12.421Z",
  sampledFrom: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources (first 5 page(s) of 100, in the API's own order)",
  pagesRead: 5,
  resources: 500,
  withCounters: 500,
  totalCalls30d: 1114606,
  uniquePayers30d: 33404,
  medianCalls30d: 41,
  note: "calls, not settled payments, and not revenue — the field is l30DaysTotalCalls and the docs do not define whether refused or retried calls count",
};

function snapshot(overrides: Partial<BazaarDemandSnapshot> = {}): BazaarDemandSnapshot {
  return { ...snapshotBase, ...overrides };
}

function render(bazaar: BazaarDemandSnapshot, view: DemandView = readyView()): string {
  return renderToStaticMarkup(createElement(DemandSourcesPanel, { view, bazaar }));
}

describe("the Bazaar label comes from the data", () => {
  it("renders the snapshot's note instead of a label retyped in the component", () => {
    const note = "calls, not settled payments, and not revenue — fixture note A";
    const html = render(snapshot({ note }));
    expect(html).toContain(note);
    expect(html).not.toContain("the docs do not define whether refused or retried calls count");
  });

  it("changes the rendered page text when the fixture's note changes", () => {
    const first = render(snapshot({ note: "calls, not settled payments, and not revenue — fixture one" }));
    const second = render(snapshot({ note: "calls, not settled payments, and not revenue — fixture two" }));
    expect(first).toContain("fixture one");
    expect(second).toContain("fixture two");
    expect(first).not.toContain("fixture two");
    expect(second).not.toContain("fixture one");
  });

  it("ships the collector's note in the committed generated snapshot", () => {
    expect(BAZAAR_DEMAND.note).toContain("calls, not settled payments, and not revenue");
  });
});

describe("both numbers render with their definitions", () => {
  it("shows the walked count and the Bazaar count side by side, each with its definition", () => {
    const html = render(snapshot());
    expect(html).toContain("68");
    expect(html).toContain("2,000-block window");
    expect(html).toContain("1,114,606");
    expect(html).toContain("l30DaysTotalCalls summed over a 500-resource sample of a ~40k catalogue");
    expect(html).toContain("first five pages");
    expect(html).toContain(snapshotBase.note);
  });

  it("derives the sample definition from the snapshot's own resource and page counts", () => {
    const definition = bazaarSampleDefinition(snapshot({ resources: 300, pagesRead: 3 }));
    expect(definition).toContain("300-resource sample");
    expect(definition).toContain("first three pages");
    expect(definition).not.toContain("500-resource");
  });

  it("derives the walked definition from the row's own block window and date", () => {
    const definition = walkedDemandDefinition({ windowBlocks: 2000, runDate: "2026-11-22" });
    expect(definition).toContain("2,000-block window");
    expect(definition).toContain("run 2026-11-22");
    expect(definition).toContain("eth_getLogs");
  });
});

describe("never a counter without its label or definition", () => {
  it("withholds the Bazaar counter when the snapshot has no note, keeping the definition visible", () => {
    const html = render(snapshot({ note: "" }));
    expect(html).not.toContain("1,114,606");
    expect(html).toContain("Counter withheld");
    expect(html).toContain("l30DaysTotalCalls summed over a 500-resource sample");
  });

  it("renders the Bazaar side even when the walked row could not be read", () => {
    const html = render(snapshot(), { kind: "unreadable", reason: "the database could not be reached" });
    expect(html).toContain("1,114,606");
    expect(html).toContain("could not be reached");
    expect(html).toContain("a failed read is not a zero");
  });

  it("renders an em dash, not a zero, when no walked row exists", () => {
    const html = render(snapshot(), { kind: "none" });
    expect(html).toContain("1,114,606");
    expect(html).toContain("an absent row is not a zero");
  });
});

describe("the two sources are never joined", () => {
  it("renders no chart and no ratio between the figures", () => {
    const html = render(snapshot());
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("%");
    expect(html).toContain("not as a ratio or a trend");
    expect(html).toContain("neither is revenue");
  });

  it("names both windows in the comparison notice", () => {
    expect(bazaarComparisonNotice(2000)).toContain("2,000-block walk");
    expect(bazaarComparisonNotice(2000)).toContain("30-day call counters");
    expect(bazaarComparisonNotice(null)).toContain("window cannot be read");
  });
});
