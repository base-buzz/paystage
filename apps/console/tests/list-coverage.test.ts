import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FRESH_DAYS,
  STALE_DAYS,
  ageInDays,
  buildCoverage,
  buildGrowth,
  freshnessTone,
  freshnessView,
  growthLabel,
  refreshLine,
  sourceBar,
} from "@/lib/list-coverage";
import { LISTS } from "@/lib/lists.generated";

/**
 * The /lists derivations (#363).
 *
 * A precise count without a denominator reads as completeness, and a chip on a list with no upstream feed
 * invents a signal. These tests pin the arithmetic (dedupe across lists), the thresholds (7/45 days), the
 * one-sample rule, and the refresh strip's refusal to call "unknown" a success.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0); // 2026-11-22T12:00:00Z
const daysAgo = (days: number, hours = 0): string => new Date(NOW - days * DAY - hours * 3_600_000).toISOString();

describe("coverage numerator and denominator", () => {
  it("deduplicates the same address across lists", () => {
    const coverage = buildCoverage(
      [
        { id: "ofac", label: "OFAC", addresses: ["0xaa", "0xbb"] },
        { id: "circle", label: "Circle", addresses: ["0xbb", "0xcc"] },
      ],
      1_321,
    );
    expect(coverage.numerator).toBe(3);
    expect(coverage.rawTotal).toBe(4);
    expect(coverage.duplicatesRemoved).toBe(1);
    expect(coverage.dedupedAcrossLists).toBe(true);
    expect(coverage.perList[1]).toMatchObject({ id: "circle", count: 2, uniqueContribution: 1, overlapsWith: ["ofac"] });
  });

  it("lowercases before comparing, so checksum case is not a second address", () => {
    const coverage = buildCoverage(
      [
        { id: "a", label: "A", addresses: ["0xABCDEF"] },
        { id: "b", label: "B", addresses: ["0xabcdef"] },
      ],
      10,
    );
    expect(coverage.numerator).toBe(1);
    expect(coverage.duplicatesRemoved).toBe(1);
  });

  it("uses the catalogue denominator as the ratio", () => {
    const coverage = buildCoverage([{ id: "a", label: "A", addresses: ["0xaa", "0xbb"] }], 1_321);
    expect(coverage.denominator).toBe(1_321);
    expect(coverage.ratio).toBeCloseTo(2 / 1_321, 10);
    expect(coverage.percent).toBeCloseTo((2 / 1_321) * 100, 8);
  });

  it("returns no denominator rather than borrowing one when the catalogue is missing", () => {
    const coverage = buildCoverage([{ id: "a", label: "A", addresses: ["0xaa"] }], null);
    expect(coverage.numerator).toBe(1);
    expect(coverage.denominator).toBeNull();
    expect(coverage.ratio).toBeNull();
    expect(coverage.percent).toBeNull();
  });

  it("treats a zero denominator as unavailable, not as infinite coverage", () => {
    expect(buildCoverage([{ id: "a", label: "A", addresses: ["0xaa"] }], 0).ratio).toBeNull();
  });
});

describe("freshness chips", () => {
  it("is green below 7 days, amber below 45, red at 45 or more", () => {
    expect(FRESH_DAYS).toBe(7);
    expect(STALE_DAYS).toBe(45);
    expect(freshnessTone(0)).toBe("green");
    expect(freshnessTone(6)).toBe("green");
    expect(freshnessTone(7)).toBe("amber");
    expect(freshnessTone(44)).toBe("amber");
    expect(freshnessTone(45)).toBe("red");
    expect(freshnessTone(90)).toBe("red");
  });

  it("reads whole days and clamps a future date to zero", () => {
    expect(ageInDays(daysAgo(6, 12), NOW)).toBe(6);
    expect(ageInDays(new Date(NOW + DAY).toISOString(), NOW)).toBe(0);
  });

  it("renders a chip from an upstream change date", () => {
    const view = freshnessView(
      { upstreamChangedAt: daysAgo(2), basis: "last-modified", reviewedAt: null, hasUpstreamFeed: true },
      NOW,
    );
    expect(view.kind).toBe("chip");
    if (view.kind === "chip") {
      expect(view.tone).toBe("green");
      expect(view.label).toBe("2d");
      expect(view.basis).toBe("last-modified");
    }
  });

  it("says reviewed, no upstream feed, for drainers instead of showing a chip", () => {
    const view = freshnessView(
      { upstreamChangedAt: null, basis: "review", reviewedAt: "2026-11-02", hasUpstreamFeed: false },
      NOW,
    );
    expect(view.kind).toBe("reviewed");
    expect(view.label).toBe("reviewed 2026-11-02, no upstream feed");
  });

  it("does not invent a review date for sinks", () => {
    const view = freshnessView({ upstreamChangedAt: null, basis: "none", reviewedAt: null, hasUpstreamFeed: false }, NOW);
    expect(view.kind).toBe("reviewed");
    expect(view.label).toBe("no upstream feed, no review date recorded");
  });
});

describe("one sample is not a trend", () => {
  it("renders the count and 'one sample' for a single retrieval", () => {
    const series = buildGrowth([{ at: "2026-11-22T09:48:26.837Z", count: 123 }]);
    expect(series.oneSample).toBe(true);
    expect(series.drawLine).toBe(false);
    expect(series.delta).toBeNull();
    expect(growthLabel(series, 123)).toBe("123 entries · one sample (2026-11-22)");
  });

  it("draws a line only from two samples, with the delta between them", () => {
    const series = buildGrowth([
      { at: "2026-11-02", count: 20 },
      { at: "2026-11-22", count: 24 },
    ]);
    expect(series.oneSample).toBe(false);
    expect(series.drawLine).toBe(true);
    expect(series.delta).toBe(4);
    expect(growthLabel(series, 24)).toBe("24 entries · +4 over 2 samples");
  });

  it("says no sample was recorded when the list stores no retrieval date", () => {
    const series = buildGrowth([]);
    expect(series.points).toHaveLength(0);
    expect(series.drawLine).toBe(false);
    expect(growthLabel(series, 2)).toBe("2 entries · no retrieval sample recorded");
  });
});

describe("source stacking", () => {
  it("makes a single-publisher list visibly single-source", () => {
    const bar = sourceBar([{ name: "US Treasury OFAC", count: 123 }]);
    expect(bar.singleSource).toBe(true);
    expect(bar.contributing).toBe(1);
    expect(bar.slices).toHaveLength(1);
    expect(bar.slices[0].percent).toBe(100);
  });

  it("splits a multi-source list by contributed entries and drops empty sources", () => {
    const bar = sourceBar([
      { name: "A", count: 3 },
      { name: "B", count: 1 },
      { name: "C", count: 0 },
    ]);
    expect(bar.singleSource).toBe(false);
    expect(bar.contributing).toBe(2);
    expect(bar.slices.map((slice) => slice.percent)).toEqual([75, 25]);
  });
});

describe("refresh strip", () => {
  it("says a failed last run failed", () => {
    const line = refreshLine({
      command: "node /work/ops/bin/ofac-sync.mjs",
      where: "hourly canary — bin/canary-digest.sh",
      lastRunAt: "2026-11-22T09:00:00Z",
      status: "failed",
      lastResult: "HTTP 503",
    });
    expect(line).toContain("last run failed");
    expect(line).toContain("HTTP 503");
  });

  it("does not report an unknown result as a success", () => {
    const line = refreshLine({
      command: "curated in packages/preflight/src/known-drainers.ts",
      where: "repository — no scheduled fetch",
      lastRunAt: null,
      status: "unknown",
      lastResult: "no fetch to report",
    });
    expect(line).toContain("no last result recorded");
    expect(line).not.toContain("last result (");
  });

  it("prints the last successful result with its date", () => {
    const line = refreshLine({
      command: "node /work/ops/bin/ofac-sync.mjs",
      where: "hourly canary — bin/canary-digest.sh",
      lastRunAt: "2026-11-22T09:45:43.782Z",
      status: "ok",
      lastResult: "unchanged",
    });
    expect(line).toBe("last result (2026-11-22): unchanged");
  });
});

describe("/lists page", () => {
  const SOURCE = readFileSync(join(import.meta.dirname, "../src/app/lists/page.tsx"), "utf8");

  it("renders coverage from the generated manifest", () => {
    expect(SOURCE).toContain("LISTS.coverage");
    expect(SOURCE).toContain("coverage.numerator");
    expect(SOURCE).toContain("coverage.denominator");
  });

  it("does not type the numerator or denominator into the page", () => {
    expect(SOURCE).not.toMatch(/\b1,?226\b/);
    expect(SOURCE).not.toMatch(/\b1,?321\b/);
    expect(SOURCE).not.toMatch(/\b229\b/);
  });

  it("uses monograms rather than image logos", () => {
    expect(SOURCE).toContain("lp-list-monogram");
    expect(SOURCE).not.toMatch(/<img\b/);
  });
});

describe("generated manifest", () => {
  it("has a positive catalogue denominator for the coverage bar", () => {
    expect(LISTS.coverage.denominator).toBeGreaterThan(0);
    expect(LISTS.coverage.numerator).toBeGreaterThan(0);
    expect(LISTS.coverage.percent).toBeGreaterThan(0);
    expect(LISTS.coverage.percent).toBeLessThanOrEqual(100);
  });

  it("keeps the per-list dedupe arithmetic equal to the numerator", () => {
    const contributed = LISTS.coverage.perList.reduce((sum, list) => sum + list.uniqueContribution, 0);
    expect(contributed).toBe(LISTS.coverage.numerator);
    expect(LISTS.coverage.rawTotal - LISTS.coverage.duplicatesRemoved).toBe(LISTS.coverage.numerator);
  });

  it("attributes every drainer entry to a source, so the stacked bar is the whole count", () => {
    // The first version's line regex skipped the three entries carrying an inline `// share` comment: the
    // bar summed to 21 while the card said 24. This is the guard.
    const attributed = LISTS.drainers.sourceCounts.reduce((sum, source) => sum + source.count, 0);
    expect(attributed).toBe(LISTS.drainers.addresses);
    expect(LISTS.drainers.contributingSources).toBeGreaterThan(1);
  });
});
