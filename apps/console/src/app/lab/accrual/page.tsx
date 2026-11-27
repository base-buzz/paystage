import type { Metadata } from "next";

import "../../landing.css";
import "./accrual.css";

import { AccrualView } from "@/components/AccrualView";
import { loadAccrual } from "@/lib/accrual-http";

export const dynamic = "force-dynamic";

/**
 * `/lab/accrual` (#474) — the period accrual a manager can download.
 *
 * Unlisted and noindex, like the rest of `/lab`: this is an operational record, not a marketing
 * page. It sits beside `/lab/refusals`, and the refusals page links here in one line.
 *
 * All three surfaces (this page, the CSV, the JSON) go through `loadAccrual`, so the number on the
 * page and the number in the file are the same number.
 */
export const metadata: Metadata = {
  title: "Accrual — one row per vendor, cost centre and month",
  description:
    "A period accrual over settled payments, in integer micro-USDC, with the SHA-256 of the decisions behind each row. Cost centres come from an explicit mapping file or `unassigned`.",
  robots: { index: false, follow: false, nocache: true },
};

function paramsOf(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) params.set(key, value[0]);
  }
  return params;
}

export default async function AccrualPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const loaded = await loadAccrual(paramsOf(await searchParams));

  if (!loaded.ok) {
    return (
      <main className="lp accrual-page">
        <div className="lp-wrap accrual-wrap">
          <header className="accrual-hero">
            <p className="accrual-eyebrow">Lab · #474 · accrual</p>
            <h1>The accrual could not be built.</h1>
            <p className="accrual-lede accrual-lede--hero">
              {loaded.message}. This page does not fall back to an empty table: an unreadable events
              table and a quiet month are different facts.
            </p>
            <p className="accrual-link">
              <a href="/lab/accrual">Retry this month</a> · <a href="/lab/refusals">the refusals record</a>
            </p>
          </header>
        </div>
      </main>
    );
  }

  return (
    <main className="lp accrual-page">
      <div className="lp-wrap">
        <AccrualView range={loaded.range} rows={loaded.rows} summary={loaded.summary} />
      </div>
    </main>
  );
}
