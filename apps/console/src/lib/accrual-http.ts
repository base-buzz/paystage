/**
 * One loader for the page, the CSV route and the JSON route.
 *
 * The three surfaces share the range resolution, the read, the cost-centre mapping, the aggregation
 * and the summary. If they did not, the page could show one total and the CSV another. This module
 * is the only place that sequence is written down.
 */

import costCentreMapRaw from "./accrual-cost-centres.json";
import {
  buildAccrual,
  normalizeCostCentreMap,
  resolveAccrualRange,
  type AccrualRange,
  type AccrualRow,
  type AccrualSummary,
} from "./accrual";
import { readAccrualDecisions } from "./accrual-source";

export type AccrualLoad =
  | { ok: true; range: AccrualRange; rows: AccrualRow[]; summary: AccrualSummary }
  | { ok: false; status: number; message: string };

/**
 * Resolve, read and aggregate for a query string.
 *
 * A failed read is a failure, never an empty export: an unreadable events table and a quiet month
 * are different facts, and a finance file that opens as a header-only CSV would be the wrong one.
 */
export async function loadAccrual(params: URLSearchParams): Promise<AccrualLoad> {
  const resolved = resolveAccrualRange(params);
  if (!resolved.ok) return { ok: false, status: 400, message: resolved.error };

  let map;
  try {
    map = normalizeCostCentreMap(costCentreMapRaw);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      message: `the cost-centre mapping is not usable (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  const read = await readAccrualDecisions(resolved.range);
  if (!read.ok) {
    if (read.tooLarge === true) return { ok: false, status: 413, message: read.reason };
    return {
      ok: false,
      status: 503,
      message:
        `the events table could not be read (${read.reason}` +
        `${read.status === undefined ? "" : `, HTTP ${read.status}`}). No export was produced.`,
    };
  }

  const built = await buildAccrual(read.decisions, map);
  return { ok: true, range: resolved.range, rows: built.rows, summary: built.summary };
}
