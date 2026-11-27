/**
 * Read the decisions an accrual needs from `public.events`.
 *
 * SERVER ONLY: this module uses the service key through `selectRowsStrict`, so a missing key is an
 * error, not zero rows. It reads only `settled` and `do_not_pay` — an accrual does not need the
 * 10,000 `402`s, and fetching them would make the page slow while changing no row.
 *
 * `amount_usdc::text` is deliberate. PostgREST would otherwise decode `numeric` as a JSON number,
 * and a float must never reach the integer arithmetic. The cast keeps the exact decimal string the
 * database holds, so `decimalToMinor` can parse it without rounding.
 *
 * PostgREST caps a response at the project's max-rows (1,000 here), so one request would silently
 * read the first page and call it the range. This pages until a short page, and refuses when the
 * range is larger than the export will serve rather than truncating it.
 */

import "server-only";

import type { AccrualDecision } from "./accrual";
import { MAX_ACCRUAL_ROWS } from "./accrual";
import { selectRowsStrict } from "./supabase";

export const ACCRUAL_PAGE_SIZE = 1000;

/** The query both routes and the page send. Exported so a test can assert the contract. */
export function accrualEventsQuery(from: string, to: string, offset: number): string {
  return (
    "select=id,ts,decision,amount_usdc::text,pay_to,network" +
    "&decision=in.(settled,do_not_pay)" +
    // `id` breaks ties so offset pagination cannot repeat or skip a decision at a shared timestamp.
    "&order=ts.asc,id.asc" +
    `&ts=gte.${encodeURIComponent(from)}` +
    `&ts=lte.${encodeURIComponent(to)}` +
    `&limit=${ACCRUAL_PAGE_SIZE}&offset=${offset}`
  );
}

export type AccrualRead =
  | { ok: true; decisions: AccrualDecision[] }
  | { ok: false; reason: string; status?: number; tooLarge?: boolean };

export async function readAccrualDecisions(range: { from: string; to: string }): Promise<AccrualRead> {
  const decisions: AccrualDecision[] = [];
  for (let offset = 0; ; offset += ACCRUAL_PAGE_SIZE) {
    const result = await selectRowsStrict<AccrualDecision>(
      "events",
      accrualEventsQuery(range.from, range.to, offset),
    );
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        status: result.status,
      };
    }
    decisions.push(...result.rows);
    if (decisions.length > MAX_ACCRUAL_ROWS) {
      return {
        ok: false,
        reason: `the range holds more than ${MAX_ACCRUAL_ROWS} decisions`,
        tooLarge: true,
      };
    }
    if (result.rows.length < ACCRUAL_PAGE_SIZE) return { ok: true, decisions };
  }
}
