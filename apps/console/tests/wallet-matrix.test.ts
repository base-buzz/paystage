import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MATRIX,
  countOutcomes,
  isStale,
  outcomeOf,
  rowsMostlyUnassessed,
  staleCells,
  summaryLine,
  type Cell,
} from "@/lib/wallet-matrix";

/**
 * The /compare matrix (#366).
 *
 * The failure this pins is the one the backlog names: an unassessed cell quietly becoming a no, or a mark
 * losing its source. The page is credible only while "we did not confirm this" stays a different answer
 * from "we confirmed it does not".
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0); // 2026-11-22T12:00:00Z

describe("wallet matrix shape", () => {
  it("has a cell for every row and column", () => {
    for (const row of MATRIX.rows) {
      for (const column of MATRIX.columns) expect(row.cells[column], `${row.capability} / ${column}`).toBeDefined();
    }
    expect(new Set(MATRIX.rows.map((row) => row.capability)).size).toBe(MATRIX.rows.length);
  });

  it("gives every assessed cell an https source and a real read date", () => {
    for (const row of MATRIX.rows) {
      for (const cell of Object.values(row.cells)) {
        if (cell === "unassessed") continue;
        expect(cell.source).toMatch(/^https:\/\//);
        expect(cell.readDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isFinite(Date.parse(cell.readDate))).toBe(true);
      }
    }
  });

  it("marks exactly one shaded row, and it is independence from the payer's wallet", () => {
    const shaded = MATRIX.rows.filter((row) => row.shaded);
    expect(shaded).toHaveLength(1);
    expect(shaded[0].capability).toBe("Independent of the payer's wallet");
  });

  it("uses monograms, not logos", () => {
    for (const column of MATRIX.columns) expect(MATRIX.columnMeta[column].monogram).toMatch(/^[A-Z]{2}$/);
    const page = readFileSync(join(import.meta.dirname, "../src/app/compare/page.tsx"), "utf8");
    expect(page).not.toMatch(/<img\b|logo\.svg|wordmark/i);
  });
});

describe("outcome counts", () => {
  it("keeps unassessed as its own outcome, not a no", () => {
    expect(outcomeOf("unassessed")).toBe("unassessed");
    expect(outcomeOf({ mark: "no", source: "https://example.com", readDate: "2026-11-22" })).toBe("no");
    const counts = countOutcomes();
    expect(counts["Coinbase Wallet MCP"].unassessed).toBe(6);
    expect(counts.PayStage).toEqual({ yes: 10, no: 0, na: 0, unassessed: 0, total: 10 });
  });

  it("counts the vendor columns the way the page prints them", () => {
    const counts = countOutcomes();
    expect(counts["MetaMask (Delegation Toolkit)"]).toEqual({ yes: 3, no: 2, na: 0, unassessed: 5, total: 10 });
    expect(counts["Safe (modules)"]).toEqual({ yes: 3, no: 2, na: 0, unassessed: 5, total: 10 });
    expect(counts["Coinbase Wallet MCP"]).toEqual({ yes: 2, no: 2, na: 0, unassessed: 6, total: 10 });
  });

  it("names the rows that stayed almost entirely unassessed", () => {
    const rows = rowsMostlyUnassessed().map((row) => row.capability);
    expect(rows).toContain("Holds no keys");
    expect(rows).toContain("Payee allow-list");
    expect(rows).toContain("Names the rule that fired");
    expect(rows).toContain("Third-party-verifiable receipt");
    expect(rows).toContain("Not the seller either");
    expect(rows).toHaveLength(5);
  });

  it("derives the summary sentence from the same counts", () => {
    expect(summaryLine(countOutcomes())).toBe("40 cells: 18 sourced yes, 6 sourced no, 0 not applicable, 16 unassessed.");
  });
});

describe("freshness", () => {
  const cell: Cell = { mark: "yes", source: "https://example.com", readDate: "2026-11-22" };

  it("accepts a cell inside the 90-day window", () => {
    expect(isStale(cell, NOW)).toBe(false);
  });

  it("flags a cell read more than 90 days ago", () => {
    const old: Cell = { ...cell, readDate: new Date(NOW - 91 * DAY).toISOString().slice(0, 10) };
    expect(isStale(old, NOW)).toBe(true);
    expect(staleCells(MATRIX, new Date(NOW))).toEqual([]);
  });

  it("never treats an unassessed cell as stale, because it has no date to age", () => {
    expect(isStale("unassessed", NOW)).toBe(false);
  });

  it("keeps the shipped copy inside the same 90-day window the ops checker enforces", () => {
    // Deliberately the real clock: a table that has aged out should fail here before the page is built,
    // the same way check-comparison-freshness fails the ops pipeline.
    expect(staleCells(MATRIX, Date.now())).toEqual([]);
  });
});
