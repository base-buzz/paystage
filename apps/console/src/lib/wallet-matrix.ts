/**
 * The derivation behind `/compare` (#366): a capability matrix where every mark carries its own source and
 * read date, and a cell nobody confirmed is `unassessed` rather than a no.
 *
 * The data lives in `docs/state/comparisons/wallets.json` and is checked by
 * `/work/ops/bin/check-comparison-freshness.mjs`, which fails on an unsourced mark, a missing date, a future
 * date, or a read date older than 90 days. This module is pure — no clock, no network, no React — so the
 * counts and the staleness branch can be tested rather than re-implemented in JSX.
 */
import matrix from "../../../../docs/state/comparisons/wallets.json";

export type Mark = "yes" | "no" | "na";
export type Cell = "unassessed" | { mark: Mark; source: string; readDate: string; [key: string]: unknown };

export interface MatrixRow {
  capability: string;
  definition: string;
  shaded?: boolean;
  cells: Record<string, Cell>;
}

export interface MatrixColumnMeta {
  monogram: string;
  vendor: string;
  role: string;
}

export interface MatrixNotes {
  unassessed: string;
  conflict: string;
  trademark: string;
  productsChange: string;
  velocity: string;
  receipt: string;
}

export interface WalletMatrix {
  computedOn: string;
  title: string;
  columns: string[];
  columnMeta: Record<string, MatrixColumnMeta>;
  rows: MatrixRow[];
  notes: MatrixNotes;
}

export const MATRIX = matrix as unknown as WalletMatrix;

export type Outcome = "yes" | "no" | "na" | "unassessed";

export interface ColumnCounts {
  yes: number;
  no: number;
  na: number;
  unassessed: number;
  total: number;
}

/** `unassessed` is its own outcome, never folded into `no`. */
export function outcomeOf(cell: Cell | undefined): Outcome {
  if (cell === "unassessed" || cell === undefined) return "unassessed";
  return cell.mark;
}

/** Counts per column, in column order. Every cell is counted exactly once. */
export function countOutcomes(data: WalletMatrix = MATRIX): Record<string, ColumnCounts> {
  const counts: Record<string, ColumnCounts> = {};
  for (const column of data.columns) counts[column] = { yes: 0, no: 0, na: 0, unassessed: 0, total: 0 };
  for (const row of data.rows) {
    for (const column of data.columns) {
      const bucket = counts[column];
      const outcome = outcomeOf(row.cells[column]);
      bucket[outcome] += 1;
      bucket.total += 1;
    }
  }
  return counts;
}

/** A row is "mostly unassessed" when at least three of its four vendor cells are blanks. */
export function rowsMostlyUnassessed(data: WalletMatrix = MATRIX): MatrixRow[] {
  return data.rows.filter((row) => {
    const blanks = data.columns.filter((column) => outcomeOf(row.cells[column]) === "unassessed").length;
    return blanks >= 3;
  });
}

/** Whether a cell's read date is outside the same 90-day window the checker enforces. */
export function isStale(cell: Cell | undefined, now: Date | number | string, maxAgeDays = 90): boolean {
  if (cell === "unassessed" || cell === undefined) return false;
  const read = Date.parse(cell.readDate);
  const current = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(read) || !Number.isFinite(current)) return true;
  return Math.floor((current - read) / 86_400_000) > maxAgeDays;
}

/** Sourced cells whose date has aged out, so the page can warn before CI does. */
export function staleCells(data: WalletMatrix = MATRIX, now: Date | number | string = new Date()): string[] {
  const stale: string[] = [];
  for (const row of data.rows) {
    for (const column of data.columns) {
      if (isStale(row.cells[column], now)) stale.push(`${row.capability} / ${column}`);
    }
  }
  return stale;
}

/** The one-line count sentence, derived so the page cannot drift from the file. */
export function summaryLine(counts: Record<string, ColumnCounts>): string {
  const all = Object.values(counts);
  const yes = all.reduce((sum, c) => sum + c.yes, 0);
  const no = all.reduce((sum, c) => sum + c.no, 0);
  const na = all.reduce((sum, c) => sum + c.na, 0);
  const unassessed = all.reduce((sum, c) => sum + c.unassessed, 0);
  const total = all.reduce((sum, c) => sum + c.total, 0);
  return `${total} cells: ${yes} sourced yes, ${no} sourced no, ${na} not applicable, ${unassessed} unassessed.`;
}
