import { NextResponse } from "next/server";
import { selectRows, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Settled totals, as data rather than as part of the page.
 *
 * The lander used to render this in an async server component, which added `revalidate` to a page that
 * was otherwise fully static — and a static page with incremental regeneration needs a cache binding
 * the console Worker does not have. The result was a 500 on the apex in production and a clean 200
 * locally, because the local standalone server has that cache and Workers does not.
 *
 * Keeping the page static and fetching this from the browser avoids the whole class of problem: no ISR,
 * no build-time credentials, and the failure mode is a blank strip rather than a dead homepage.
 *
 * The service key stays server-side; the browser never sees it.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = { amount_usdc: number | string | null; ts: string; source: string };

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  }

  const rows = await selectRows<Row>(
    "events",
    "select=amount_usdc,ts,source&decision=eq.settled&order=ts.desc&limit=500",
  );

  if (rows === null) {
    return NextResponse.json({ configured: true, error: "unreadable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const total = rows.reduce((sum, r) => sum + Number(r.amount_usdc ?? 0), 0);
  const priced = rows.filter((r) => r.amount_usdc !== null && r.amount_usdc !== undefined).length;
  const external = rows.filter((r) => r.source === "real").length;

  return NextResponse.json(
    {
      configured: true,
      settled: rows.length,
      totalUsdc: Number(total.toFixed(4)),
      // Rows written before 2026-11-17 carry no amount (#131). Summing them as zero made "35 settled,
      // 0.002 USDC" look like a measured total when it was one priced row and 34 unknowns — so the
      // count of unpriced rows is part of the answer, not a footnote.
      priced,
      withoutAmount: rows.length - priced,
      external,
      ours: rows.length - external,
      last: rows[0]?.ts ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
