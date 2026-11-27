/**
 * `GET /lab/accrual.json` (#474) — the same rows as the CSV, with the same field names.
 *
 * A JSON array, not an envelope: a script does `rows.map(...)` and gets exactly what the
 * spreadsheet gets. `total_minor` is an integer in micro-USDC in both.
 */

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

  return new Response(JSON.stringify(loaded.rows), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
