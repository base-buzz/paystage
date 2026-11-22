import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketMovementPanel } from "@/components/MarketMovementPanel";
import { MarketSupplyPanel } from "@/components/MarketSupplyPanel";
import {
  NO_COMPARABLE_DAY,
  SERIES_WINDOW_DAYS,
  buildMarketSeries,
  buildPayeeDelta,
  buildSeries,
  concentrationNotice,
  concentrationOf,
  coverageOf,
  formatMetricDelta,
  formatMetricValue,
  normalizeRunDate,
  payeeDeltaAddresses,
  payeeDeltaSummary,
  payeeSetOf,
  seriesSegments,
  topPayees,
  topTenAccepts,
} from "@/lib/market-series";
import type { MarketDemandRow, MarketSupplyRow } from "@/lib/market-demand";

/**
 * The market series (#322).
 *
 * The item's whole premise is that one point is not a trend and a gap is not a zero. These tests pin the three places
 * that can quietly break: the calendar (a day with no row must exist as `missing`), the delta (it must refuse across
 * a gap rather than subtract across it), and readiness (a line starts at seven consecutive days, not six).
 */

/** A supply row with a plausible catalogue shape. */
function supply(
  run_date: string,
  overrides: Partial<MarketSupplyRow> = {},
): MarketSupplyRow {
  return {
    run_date,
    resources: 500,
    accepts: 100,
    payees: 40,
    hosts: 12,
    top_payees: [
      { payee: "0xpayee-a", accepts: 30, resources: 30, hosts: 2 },
      { payee: "0xpayee-b", accepts: 20, resources: 20, hosts: 1 },
    ],
    payee_set: Array.from({ length: 40 }, (_, i) => `0xpayee-${i.toString().padStart(2, "0")}`),
    ...overrides,
  };
}

/** A demand row measured against a 40-payee catalogue. */
function demand(
  run_date: string,
  overrides: Partial<MarketDemandRow> = {},
): MarketDemandRow {
  return {
    run_date,
    window_blocks: 2000,
    chain_usdc_transfers: 16000,
    payee_transfers: 20,
    payee_transfers_value_usdc: 1.5,
    distinct_payees_paid: 4,
    distinct_payers: 3,
    repeat_payers: 1,
    payees_listed: 999, // deliberately wrong: coverage must use market_supply.payees
    sampled_payees: 40,
    size_p50_usdc: 0.01,
    size_p90_usdc: 0.05,
    control_topic_filter: true,
    ...overrides,
  };
}

function consecutive(days: number, end = "2026-11-21"): { supply: MarketSupplyRow[]; demand: MarketDemandRow[] } {
  const endAt = Date.parse(`${end}T00:00:00Z`);
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(endAt - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
  return { supply: dates.map((date) => supply(date)), demand: dates.map((date) => demand(date)) };
}

describe("the calendar and gap detection", () => {
  it("keeps a day with no row as an explicit missing point, with a null value", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-19"), supply("2026-11-21")],
      demand: [demand("2026-11-19"), demand("2026-11-21")],
    });
    expect(series.points.map((point) => point.runDate)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
    const gap = series.byDate["2026-11-20"]!;
    expect(gap.missing).toBe(true);
    expect(gap.supplyMissing).toBe(true);
    expect(gap.demandMissing).toBe(true);
    expect(gap.coverage).toBeNull();
    expect(gap.payeeTransfers).toBeNull();
    expect(gap.accepts).toBeNull();
  });

  it("never renders a missing day as zero anywhere in the series", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-19"), supply("2026-11-21")],
      demand: [demand("2026-11-19"), demand("2026-11-21")],
    });
    const gap = series.byDate["2026-11-20"]!;
    const coveragePoint = series.metrics.coverage.byDate["2026-11-20"]!;
    const acceptsPoint = series.metrics.accepts.byDate["2026-11-20"]!;

    for (const value of [gap.accepts, gap.payeeTransfers, gap.coverage, gap.concentration]) {
      expect(value).not.toBe(0);
      expect(value).toBeNull();
    }
    expect(coveragePoint.missing).toBe(true);
    expect(coveragePoint.value).toBeNull();
    expect(acceptsPoint.missing).toBe(true);
    expect(acceptsPoint.value).toBeNull();
    expect(formatMetricValue("coverage", coveragePoint.value)).toBe("—");
    expect(formatMetricValue("accepts", acceptsPoint.value)).toBe("—");
  });

  it("marks a day present in only one table as missing for the metric that needs the other half", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-20"), supply("2026-11-21")],
      demand: [demand("2026-11-21")],
    });
    expect(series.byDate["2026-11-20"]!.missing).toBe(false);
    expect(series.byDate["2026-11-20"]!.demandMissing).toBe(true);
    expect(series.byDate["2026-11-20"]!.coverage).toBeNull();
    expect(series.metrics.coverage.byDate["2026-11-20"]!.missing).toBe(true);
    expect(series.metrics.accepts.byDate["2026-11-20"]!.value).toBe(100);
  });

  it("normalises a timestamp-shaped run_date and drops an unparseable one", () => {
    expect(normalizeRunDate("2026-11-21T00:00:00+00:00")).toBe("2026-11-21");
    expect(normalizeRunDate("2026-11-21")).toBe("2026-11-21");
    expect(normalizeRunDate("not-a-date")).toBeNull();
    expect(normalizeRunDate("2026-02-31")).toBeNull();
    expect(normalizeRunDate(null)).toBeNull();
  });
});

describe("deltas never cross a gap", () => {
  it("computes a day-over-day delta when the previous calendar day has a row", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-20", { accepts: 90 }), supply("2026-11-21", { accepts: 100 })],
      demand: [demand("2026-11-20", { payee_transfers: 10, distinct_payees_paid: 2 }), demand("2026-11-21")],
    });
    const accepts = series.metrics.accepts.delta;
    expect(accepts.comparable).toBe(true);
    expect(accepts.value).toBe(10);
    expect(accepts.from).toBe("2026-11-20");
    expect(accepts.to).toBe("2026-11-21");
    expect(formatMetricDelta("accepts", accepts.value)).toBe("↑ +10");

    const transfers = series.metrics.payeeTransfers.delta;
    expect(transfers.comparable).toBe(true);
    expect(transfers.value).toBe(10);

    const coverage = series.metrics.coverage.delta;
    expect(coverage.comparable).toBe(true);
    expect(coverage.value).toBeCloseTo(4 / 40 - 2 / 40, 10);
  });

  it("refuses every delta when the previous calendar day has no row", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-19"), supply("2026-11-21", { accepts: 120 })],
      demand: [demand("2026-11-19", { payee_transfers: 5, distinct_payees_paid: 1 }), demand("2026-11-21")],
    });
    for (const metric of ["accepts", "payeeTransfers", "coverage", "concentration"] as const) {
      const delta = series.metrics[metric].delta;
      expect(delta.comparable).toBe(false);
      expect(delta.value).toBeNull();
      expect(delta.reason).toContain("2026-11-20");
      expect(formatMetricDelta(metric, delta.value)).toBe(NO_COMPARABLE_DAY);
    }
    expect(NO_COMPARABLE_DAY).toBe("no comparable day");
  });

  it("refuses a delta when the previous day's row exists but the metric is unreadable", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-20", { accepts: null }), supply("2026-11-21")],
      demand: [demand("2026-11-20"), demand("2026-11-21")],
    });
    expect(series.metrics.accepts.delta.comparable).toBe(false);
    expect(series.metrics.accepts.delta.reason).toContain("no readable value");
  });

  it("does not compare across an interior gap even when both sides have rows", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-18"), supply("2026-11-19"), supply("2026-11-21")],
      demand: [demand("2026-11-18"), demand("2026-11-19"), demand("2026-11-21")],
    });
    // Latest is 21; 20 is absent, so 19 must not be borrowed as "yesterday".
    expect(series.metrics.coverage.delta.comparable).toBe(false);
    expect(series.metrics.coverage.delta.value).toBeNull();
    expect(series.metrics.coverage.delta.from).toBe("2026-11-20");
  });
});

describe("readiness at exactly seven consecutive days", () => {
  it("is not ready at six days", () => {
    const series = buildMarketSeries(consecutive(6));
    expect(series.consecutiveDays).toBe(6);
    expect(series.ready).toBe(false);
    expect(series.metrics.coverage.consecutiveDays).toBe(6);
    expect(series.metrics.accepts.ready).toBe(false);
  });

  it("is ready at seven days", () => {
    const series = buildMarketSeries(consecutive(7));
    expect(SERIES_WINDOW_DAYS).toBe(7);
    expect(series.consecutiveDays).toBe(7);
    expect(series.ready).toBe(true);
    expect(series.metrics.coverage.ready).toBe(true);
    expect(series.metrics.accepts.ready).toBe(true);
    expect(series.metrics.payeeTransfers.ready).toBe(true);
    expect(series.metrics.concentration.ready).toBe(true);
  });

  it("resets the run at a gap before it reaches seven", () => {
    const rows = consecutive(7);
    // Remove day 4, leaving three days, a hole, then three days: neither run reaches seven.
    const gapDate = "2026-11-18";
    const series = buildMarketSeries({
      supply: rows.supply.filter((row) => row.run_date !== gapDate),
      demand: rows.demand.filter((row) => row.run_date !== gapDate),
    });
    expect(series.consecutiveDays).toBe(3);
    expect(series.ready).toBe(false);
  });
});

describe("concentration as the top-10 share", () => {
  it("divides the top-ten accepts by the catalogue's total accepts", () => {
    const row = supply("2026-11-21", {
      accepts: 100,
      top_payees: [
        { payee: "0xa", accepts: 30, resources: 3, hosts: 1 },
        { payee: "0xb", accepts: 20, resources: 2, hosts: 1 },
        { payee: "0xc", accepts: 10, resources: 1, hosts: 1 },
        { payee: "0xd", accepts: 5, resources: 1, hosts: 1 },
        { payee: "0xe", accepts: 5, resources: 1, hosts: 1 },
        { payee: "0xf", accepts: 5, resources: 1, hosts: 1 },
        { payee: "0xg", accepts: 5, resources: 1, hosts: 1 },
        { payee: "0xh", accepts: 5, resources: 1, hosts: 1 },
        { payee: "0xi", accepts: 5, resources: 1, hosts: 1 },
        { payee: "0xj", accepts: 5, resources: 1, hosts: 1 },
        { payee: "0xk", accepts: 1, resources: 1, hosts: 1 }, // 11th: not part of the top-10 share
      ],
    });
    expect(topPayees(row)).toHaveLength(10);
    expect(topTenAccepts(row)).toBe(95);
    expect(concentrationOf(row)).toBe(0.95);
    expect(formatMetricValue("concentration", concentrationOf(row))).toBe("95.00%");
    expect(concentrationNotice(row)).toContain("95.00%");
    expect(concentrationNotice(row)).toContain("95 of 100");
    expect(concentrationNotice(row)).toContain("accepts counted in the catalogue on 2026-11-21");
  });

  it("returns no share when the catalogue total is zero or unreadable", () => {
    expect(concentrationOf(supply("2026-11-21", { accepts: 0 }))).toBeNull();
    expect(concentrationOf(supply("2026-11-21", { accepts: null }))).toBeNull();
    expect(concentrationOf(null)).toBeNull();
    expect(formatMetricValue("concentration", concentrationOf(supply("2026-11-21", { accepts: 0 })))).toBe("—");
  });

  it("treats accepts with no stored top_payees as unknown, not as a zero share", () => {
    const row = supply("2026-11-21", { accepts: 100, top_payees: [] });
    expect(concentrationOf(row)).toBeNull();
    expect(topTenAccepts(row)).toBeNull();
    expect(concentrationNotice(row)).toContain("unavailable");
  });

  it("ignores malformed top_payees entries instead of counting them", () => {
    const row = supply("2026-11-21", {
      accepts: 100,
      top_payees: [
        { payee: "0xa", accepts: 40, resources: 4, hosts: 1 },
        { payee: "", accepts: 30, resources: 3, hosts: 1 },
        { payee: "0xb", accepts: "twenty", resources: 2, hosts: 1 },
        { payee: "0xc", accepts: "10", resources: "1", hosts: "1" },
      ],
    });
    expect(topPayees(row).map((p) => p.payee)).toEqual(["0xa", "0xc"]);
    expect(concentrationOf(row)).toBe(0.5);
  });
});

describe("coverage keeps the same-date catalogue denominator", () => {
  it("uses market_supply.payees, not demand.payees_listed", () => {
    expect(coverageOf(demand("2026-11-21"), supply("2026-11-21"))).toBe(4 / 40);
    expect(coverageOf(demand("2026-11-21", { payees_listed: 1 }), supply("2026-11-21"))).toBe(4 / 40);
  });

  it("has no denominator when the catalogue row for that date is absent", () => {
    expect(coverageOf(demand("2026-11-21"), supply("2026-11-20"))).toBeNull();
    const series = buildMarketSeries({
      supply: [supply("2026-11-20")],
      demand: [demand("2026-11-20"), demand("2026-11-21"), demand("2026-11-22")],
    });
    // Demand-only days outside the supply range still exist; coverage is null, not borrowed.
    expect(series.metrics.coverage.byDate["2026-11-21"]!.value).toBeNull();
    expect(series.metrics.coverage.byDate["2026-11-21"]!.missing).toBe(false);
  });
});

describe("input normalisation", () => {
  it("orders unordered rows by date", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-21"), supply("2026-11-19"), supply("2026-11-20")],
      demand: [demand("2026-11-20"), demand("2026-11-21"), demand("2026-11-19")],
    });
    expect(series.points.map((point) => point.runDate)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
    expect(series.metrics.accepts.points.map((point) => point.runDate)).toEqual([
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
    expect(series.byDate["2026-11-19"]).toBeDefined();
  });

  it("reduces duplicate dates to the newest write, independent of array order", () => {
    const older = supply("2026-11-21", { accepts: 10, created_at: "2026-11-21T01:00:00Z" });
    const newer = supply("2026-11-21", { accepts: 99, created_at: "2026-11-21T09:00:00Z" });
    const forward = buildSeries([older, newer], (row) => Number(row.accepts));
    const reverse = buildSeries([newer, older], (row) => Number(row.accepts));
    expect(forward.points).toHaveLength(1);
    expect(forward.points[0]!.value).toBe(99);
    expect(reverse.points[0]!.value).toBe(99);
  });

  it("breaks the line at a gap rather than joining across it", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-19"), supply("2026-11-20"), supply("2026-11-22")],
      demand: [demand("2026-11-19"), demand("2026-11-20"), demand("2026-11-22")],
    });
    const segments = seriesSegments(series.metrics.coverage.points);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.map((entry) => entry.point.runDate)).toEqual(["2026-11-19", "2026-11-20"]);
    expect(segments[1]!.map((entry) => entry.point.runDate)).toEqual(["2026-11-22"]);
  });

  it("draws a ready series as segments when an older gap sits inside the window", () => {
    // Ten days, with one hole eight days before the end: the trailing seven are consecutive, so the line is allowed;
    // the older hole must still split it rather than be bridged.
    const rows = consecutive(10, "2026-11-21");
    const gapDate = "2026-11-13";
    const series = buildMarketSeries({
      supply: rows.supply.filter((row) => row.run_date !== gapDate),
      demand: rows.demand.filter((row) => row.run_date !== gapDate),
    });
    expect(series.ready).toBe(true);
    expect(series.consecutiveDays).toBe(8);
    const segments = seriesSegments(series.metrics.coverage.points);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.map((entry) => entry.point.runDate)).toEqual(["2026-11-12"]);
    expect(segments[1]!.map((entry) => entry.point.runDate)).toHaveLength(8);
    expect(series.metrics.coverage.byDate[gapDate]!.value).toBeNull();
  });

  it("returns an empty, not-ready series when there are no rows at all", () => {
    const series = buildMarketSeries({ supply: [], demand: [] });
    expect(series.points).toEqual([]);
    expect(series.consecutiveDays).toBe(0);
    expect(series.ready).toBe(false);
    expect(series.metrics.coverage.delta.value).toBeNull();
    expect(series.metrics.coverage.delta.reason).toBe("no measured day yet");
  });
});


describe("payee turnover: new and gone against the previous consecutive day", () => {
  it("counts new and gone payees between two consecutive days", () => {
    const rows = [
      supply("2026-11-20", { payees: 3, payee_set: ["0xa", "0xb", "0xc"] }),
      supply("2026-11-21", { payees: 4, payee_set: ["0xb", "0xc", "0xd", "0xe"] }),
    ];
    const delta = buildPayeeDelta(rows);
    expect(delta.comparable).toBe(true);
    expect(delta.from).toBe("2026-11-20");
    expect(delta.to).toBe("2026-11-21");
    expect(delta.newPayees).toEqual(["0xd", "0xe"]);
    expect(delta.gonePayees).toEqual(["0xa"]);
    expect(payeeDeltaSummary(delta)).toBe("2 new payees, 1 gone since 2026-11-20");
  });

  it("refuses a payee delta across a gap instead of borrowing the older day", () => {
    const delta = buildPayeeDelta([
      supply("2026-11-19", { payees: 1, payee_set: ["0xa"] }),
      supply("2026-11-21", { payees: 1, payee_set: ["0xb"] }),
    ]);
    expect(delta.comparable).toBe(false);
    expect(delta.from).toBe("2026-11-20");
    expect(delta.to).toBe("2026-11-21");
    expect(delta.newPayees).toEqual([]);
    expect(delta.gonePayees).toEqual([]);
    expect(delta.reason).toContain("2026-11-20");
    expect(payeeDeltaSummary(delta)).toBe(NO_COMPARABLE_DAY);
  });

  it("treats a payee present on both days as neither new nor gone", () => {
    const delta = buildPayeeDelta([
      supply("2026-11-20", { payees: 2, payee_set: ["0xsame", "0xold"] }),
      supply("2026-11-21", { payees: 2, payee_set: ["0xsame", "0xnew"] }),
    ]);
    expect(delta.comparable).toBe(true);
    expect(delta.newPayees).toEqual(["0xnew"]);
    expect(delta.gonePayees).toEqual(["0xold"]);
    expect(delta.newPayees).not.toContain("0xsame");
    expect(delta.gonePayees).not.toContain("0xsame");

    const identical = buildPayeeDelta([
      supply("2026-11-20", { payees: 1, payee_set: ["0xsame"] }),
      supply("2026-11-21", { payees: 1, payee_set: ["0xsame"] }),
    ]);
    expect(identical.newPayees).toEqual([]);
    expect(identical.gonePayees).toEqual([]);
    expect(payeeDeltaSummary(identical)).toBe("0 new payees, 0 gone since 2026-11-20");
  });

  it("does not read a pre-column empty set on a populated row as every payee gone", () => {
    const delta = buildPayeeDelta([
      supply("2026-11-20", { payees: 1, payee_set: ["0xa"] }),
      supply("2026-11-21", { payees: 1324, payee_set: [] }),
    ]);
    expect(delta.comparable).toBe(false);
    expect(delta.gonePayees).toEqual([]);
    expect(delta.reason).toContain("no readable payee set");
    expect(payeeDeltaSummary(delta)).toBe(NO_COMPARABLE_DAY);
  });

  it("keeps an oversized set out of the markup without crashing the panel", () => {
    const many = Array.from({ length: 5000 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`);
    const rows = [
      supply("2026-11-20", { payees: 0, payee_set: [] }),
      supply("2026-11-21", { payees: many.length, payee_set: many }),
    ];
    const delta = buildPayeeDelta(rows);
    expect(delta.newPayees).toHaveLength(5000);
    const { shown, more } = payeeDeltaAddresses(delta.newPayees);
    expect(shown).toHaveLength(5);
    expect(more).toBe(4995);

    const markup = renderToStaticMarkup(createElement(MarketSupplyPanel, { rows, reason: null }));
    expect(markup).toContain("5,000 new payees, 0 gone since 2026-11-20");
    expect(markup).toContain("+4,995 more");
    expect(markup).not.toContain(many[many.length - 1]!);
  });

  it("renders the sentence and the first addresses on the supply panel", () => {
    const rows = [
      supply("2026-11-21", { payees: 3, payee_set: ["0xkeep", "0xnew1", "0xnew2"] }),
      supply("2026-11-20", { payees: 2, payee_set: ["0xkeep", "0xgone1"] }),
    ];
    const markup = renderToStaticMarkup(createElement(MarketSupplyPanel, { rows, reason: null }));
    expect(markup).toContain("2 new payees, 1 gone since 2026-11-20");
    expect(markup).toContain("0xnew1");
    expect(markup).toContain("0xgone1");
  });

  it("normalises an unordered, de-duplicated payee_set", () => {
    expect(payeeSetOf({ payee_set: ["0xb", "0xa", "0xa", " 0xc ", 7] })).toEqual(["0xa", "0xb", "0xc"]);
    expect(payeeSetOf({ payee_set: null })).toBeNull();
    expect(payeeSetOf({})).toBeNull();
  });
});

describe("what the panels actually render", () => {
  it("renders '1 of 7 days collected' and no SVG line before the series is ready", () => {
    const series = buildMarketSeries({
      supply: [supply("2026-11-21")],
      demand: [demand("2026-11-21")],
    });
    const markup = renderToStaticMarkup(createElement(MarketMovementPanel, { series, reason: null }));
    expect(series.ready).toBe(false);
    expect(markup).toContain("1 of 7 days collected");
    expect(markup).toContain("10.00%");
    expect(markup).not.toContain("<svg");
    expect(markup).toContain("no comparable day");
  });

  it("renders one SVG line only when ready", () => {
    const series = buildMarketSeries(consecutive(7));
    const markup = renderToStaticMarkup(createElement(MarketMovementPanel, { series, reason: null }));
    expect(series.ready).toBe(true);
    expect(markup).toContain("<svg");
    expect((markup.match(/<polyline/g) ?? []).length).toBe(1);
    expect(markup).not.toContain("of 7 days collected");
  });

  it("renders two polyline segments when a ready series has an older gap", () => {
    const rows = consecutive(10, "2026-11-21");
    const gapDate = "2026-11-13";
    const series = buildMarketSeries({
      supply: rows.supply.filter((row) => row.run_date !== gapDate),
      demand: rows.demand.filter((row) => row.run_date !== gapDate),
    });
    const markup = renderToStaticMarkup(createElement(MarketMovementPanel, { series, reason: null }));
    expect(series.ready).toBe(true);
    expect((markup.match(/<polyline/g) ?? []).length).toBe(2);
    expect(markup).toContain(gapDate);
  });

  it("renders the top-10 table and the concentration denominator", () => {
    const markup = renderToStaticMarkup(
      createElement(MarketSupplyPanel, { rows: [supply("2026-11-21")], reason: null }),
    );
    expect(markup).toContain("0xpayee-a");
    expect(markup).toContain("50.00%");
    expect(markup).toContain("50 of 100");
    expect(markup).toContain(">accepts<");
    expect(markup).toContain(">resources<");
    expect(markup).toContain(">hosts<");
  });
});
