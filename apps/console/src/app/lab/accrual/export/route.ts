/**
 * `GET /lab/accrual/export` (#474) — the period accrual as CSV.
 *
 * The route owns the HTTP headers and nothing else. Range, read, cost-centre mapping and
 * aggregation all come from `loadAccrual`, the same loader the page and the JSON endpoint use, so
 * the spreadsheet and the script cannot disagree.
 *
 * Failure is a plain-text error with no file. A download that opens as a header-only table would
 * read as a month with no spend, which is the one wrong answer an accrual must never give.
 */

import { buildAccrualCsv } from "@/lib/accrual";
import { loadAccrual } from "@/lib/accrual-http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const loaded = await loadAccrual(new URL(request.url).searchParams);
  if (!loaded.ok) {
    return new Response(`paystage accrual: ${loaded.message}\n`, {
      status: loaded.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response(buildAccrualCsv(loaded.rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${loaded.range.filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
