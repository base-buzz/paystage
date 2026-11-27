/**
 * The decisions CSV (#473): one row per decision, for a date range.
 *
 * Why this is not just "the refusals table as CSV": an export that contains only successes cannot show the
 * control worked. The rows here are read from `public.events` with **no decision filter**, so `do_not_pay`,
 * `review`, `settled`, `pay`, `402`, `404`, `settle_failed` and every other value land in the file in the
 * order they happened. The only thing narrowed is the window.
 *
 * `reason_codes` is the rule that fired. On this table it is frequently empty — measured 2026-11-27:
 * 851 of 852 refusals carried no rule — so an empty value is written as `not recorded`. It is never
 * blank (which reads like a formatting bug) and never filled with a guess (which would be a fabricated
 * audit trail). The same expansion as `/lab/refusals` is reused so the page and the CSV agree.
 *
 * Pure and synchronous, so the shape is testable without a database. The route in
 * `app/lab/refusals/export/route.ts` owns only the read and the HTTP headers.
 */

import { expandReasonCodes } from "./refusals";

/** The exact column order in the file. The header is the contract for whatever reads this. */
export const DECISION_EXPORT_COLUMNS = [
  "ts",
  "decision",
  "reason_codes",
  "payer",
  "amount_usdc",
  "pay_to",
  "tx_hash",
  "source",
  "tool",
] as const;

export type DecisionExportColumn = (typeof DECISION_EXPORT_COLUMNS)[number];

/** Written where `reason_codes` is empty. Never blank, never a guessed rule. */
export const RULE_NOT_RECORDED = "not recorded";

/** The page's default window (7 days), reused so the link and the page describe the same range. */
export const DEFAULT_EXPORT_DAYS = 7;

/** A ceiling that is large enough for the table and small enough to refuse honestly if it is ever hit. */
export const MAX_EXPORT_ROWS = 100_000;

/** The longest window this route will serve, so one request cannot try to serialise the whole table. */
export const MAX_EXPORT_DAYS = 366;

export interface DecisionExportRow {
  ts: string;
  decision?: string | null;
  reason_codes?: unknown;
  payer?: string | null;
  amount_usdc?: number | string | null;
  pay_to?: string | null;
  tx_hash?: string | null;
  source?: string | null;
  tool?: string | null;
}

/**
 * RFC 4180 quoting: a field is quoted when it contains a comma, a quote or a line break, and an
 * embedded quote is doubled. Everything else is written as-is so addresses and ISO timestamps stay
 * readable in a spreadsheet.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialise the rows. `\r\n` is RFC 4180's line ending, and the trailing one means a reader never has
 * to special-case the last row.
 */
export function buildDecisionCsv(rows: readonly DecisionExportRow[]): string {
  const lines = [DECISION_EXPORT_COLUMNS.join(",")];
  for (const row of rows) {
    const reasons = expandReasonCodes(row.reason_codes);
    const fields: Record<DecisionExportColumn, unknown> = {
      ts: row.ts,
      decision: row.decision,
      reason_codes: reasons.length === 0 ? RULE_NOT_RECORDED : reasons.join("; "),
      payer: row.payer,
      amount_usdc: row.amount_usdc,
      pay_to: row.pay_to,
      tx_hash: row.tx_hash,
      source: row.source,
      tool: row.tool,
    };
    lines.push(DECISION_EXPORT_COLUMNS.map((column) => csvCell(fields[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `paystage-decisions-2026-11-20_to_2026-11-27.csv` — the range is in the name, not only in the headers. */
export function decisionExportFilename(from: Date, to: Date): string {
  return `paystage-decisions-${isoDay(from)}_to_${isoDay(to)}.csv`;
}

export interface DecisionExportRange {
  /** Inclusive lower bound, ISO instant. */
  from: string;
  /** Inclusive upper bound, ISO instant. */
  to: string;
  /** The same bounds as calendar days, for the filename and the page's link. */
  fromDay: string;
  toDay: string;
  filename: string;
}

export type ExportRangeResult =
  | { ok: true; range: DecisionExportRange }
  | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBound(raw: string, edge: "start" | "end"): Date | null {
  // A date with no time is a calendar day, and a calendar day is inclusive on both ends. Treating
  // `to=2026-11-27` as midnight would silently drop that day's decisions from the export.
  const text = DATE_ONLY.test(raw) ? `${raw}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z` : raw;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve `?from=`/`?to=` against the clock. Both default to the page's 7-day window; a supplied
 * bound must be an ISO instant or `YYYY-MM-DD`. An invalid or inverted range is refused rather than
 * coerced, because a CSV covering a different window than the caller asked for is worse than no CSV.
 */
export function resolveExportRange(
  params: URLSearchParams,
  now: Date = new Date(),
): ExportRangeResult {
  const toRaw = params.get("to");
  const fromRaw = params.get("from");
  const to = toRaw === null ? now : parseBound(toRaw, "end");
  const from =
    fromRaw === null ? new Date((to ?? now).getTime() - DEFAULT_EXPORT_DAYS * 86_400_000) : parseBound(fromRaw, "start");

  if (to === null) return { ok: false, error: "`to` is not a date or an ISO instant" };
  if (from === null) return { ok: false, error: "`from` is not a date or an ISO instant" };
  if (from.getTime() > to.getTime()) return { ok: false, error: "`from` is after `to`" };

  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > MAX_EXPORT_DAYS) {
    return { ok: false, error: `the range is longer than ${MAX_EXPORT_DAYS} days; narrow it` };
  }

  return {
    ok: true,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      fromDay: isoDay(from),
      toDay: isoDay(to),
      filename: decisionExportFilename(from, to),
    },
  };
}

/**
 * The one-line link the manager clicks. Dates, not instants: the route expands them back to inclusive
 * days, so the same URL means the same window tomorrow.
 */
export function decisionExportHref(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const fromDay = Number.isNaN(from.getTime()) ? isoDay(new Date()) : isoDay(from);
  const toDay = Number.isNaN(to.getTime()) ? isoDay(new Date()) : isoDay(to);
  return `/lab/refusals/export?from=${fromDay}&to=${toDay}`;
}
