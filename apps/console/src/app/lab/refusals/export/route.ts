/**
 * `GET /lab/refusals/export` (#473) — every decision in a date range, as CSV.
 *
 * Why this route lives in `apps/console` and not `apps/hosted`:
 *
 *  - the page a manager already uses is `/lab/refusals`, and it reads `public.events` here through
 *    `selectRowsStrict`; putting the export beside it keeps one read path and one query vocabulary,
 *    and makes the link a relative URL with no cross-origin hop;
 *  - `apps/hosted` is the evaluation API. It records decisions but serves callers, not the operator's
 *    audit surface, and it has no `/lab` page to link from. Exporting is a read of the decision log,
 *    which is exactly what the console's server-side Supabase helper is for.
 *
 * The route does **no** decision filtering. `402`, `404`, `do_not_pay`, `review`, `settled`, `pay` and
 * the failure classes all belong in an audit trail; an export that keeps only successes is the failure
 * this row exists to fix. A read failure returns a plain-text error, never an empty CSV, because "no
 * decisions" and "could not read the decisions" are different facts.
 */

import {
  buildDecisionCsv,
  MAX_EXPORT_ROWS,
  resolveExportRange,
  type DecisionExportRow,
} from "@/lib/decision-export";
import { selectRowsStrict } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SELECT =
  "select=id,ts,decision,reason_codes,payer,amount_usdc,pay_to,tx_hash,source,tool" +
  // `id` breaks ties so offset pagination cannot repeat or skip a row at a shared timestamp.
  "&order=ts.asc,id.asc";

/**
 * PostgREST caps a response at the project's max-rows (1000 here), so one request would silently
 * export the first thousand decisions and call it the range. Pages are read until a short page; an
 * export that cannot be complete is refused rather than truncated.
 */
const PAGE_SIZE = 1000;

async function readAll(range: { from: string; to: string }): Promise<
  { ok: true; rows: DecisionExportRow[] } | { ok: false; response: Response }
> {
  const rows: DecisionExportRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query =
      `${SELECT}` +
      `&ts=gte.${encodeURIComponent(range.from)}` +
      `&ts=lte.${encodeURIComponent(range.to)}` +
      `&limit=${PAGE_SIZE}&offset=${offset}`;
    const result = await selectRowsStrict<DecisionExportRow & { id?: string }>("events", query);
    if (!result.ok) {
      // Never a CSV on failure: a download that opens as an empty table would read as a quiet period.
      return {
        ok: false,
        response: new Response(
          `paystage export: the events table could not be read (${result.reason}` +
            `${result.status === undefined ? "" : `, HTTP ${result.status}`}). No file was produced.\n`,
          {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
          },
        ),
      };
    }
    rows.push(...result.rows);
    if (rows.length > MAX_EXPORT_ROWS) {
      return {
        ok: false,
        response: new Response(
          `paystage export: the range holds more than ${MAX_EXPORT_ROWS} decisions; narrow the dates. ` +
            "No file was produced rather than a silently truncated one.\n",
          {
            status: 413,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
          },
        ),
      };
    }
    if (result.rows.length < PAGE_SIZE) {
      return { ok: true, rows };
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const resolved = resolveExportRange(new URL(request.url).searchParams);
  if (!resolved.ok) {
    return new Response(`paystage export: ${resolved.error}\n`, {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const { range } = resolved;

  const read = await readAll(range);
  if (!read.ok) return read.response;

  return new Response(buildDecisionCsv(read.rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${range.filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
