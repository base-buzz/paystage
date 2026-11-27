import type { Metadata } from "next";

import "../../landing.css";
import "./refusals.css";

import { RefusalsView } from "@/components/RefusalsView";
import { RollupDivisionTotal } from "@/components/RollupDivisionTotal";
import {
  buildRefusalView,
  formatRefusalTime,
  REFUSAL_CONTROL_LINE,
  REFUSAL_WINDOW_DAYS,
  type RefusalRow,
} from "@/lib/refusals";
import { fetchRollup, rollupApiBase, rollupUnit } from "@/lib/rollup";
import { selectRowsStrict } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * `/lab/refusals` (#472) — the refusals record the team lead reads.
 *
 * Route: `/lab`, not `/console`. The console is the public, script-bearing demo surface; this page is an
 * unlisted, no-index operational record with no client JavaScript. Putting it on `/console` would mix an
 * internal control record into the page a visitor evaluates, and would drag the console's client components
 * into a page whose whole value is that it is server-rendered. `/lab` already carries operational evidence
 * (`/lab`, `/lab/mesh`), so the manager gets one stable link instead of a new dashboard.
 *
 * Read path: SERVER ONLY, through `selectRowsStrict`, so "no rows" and "could not read" render differently.
 * The events table has a public read policy, but the service key is still used: the page must state when the
 * read failed rather than print a zero that looks like a quiet week.
 *
 * #471 adds one division total above the refusals. It is fetched from `GET /v1/public/rollup`, not
 * recomputed here: a page-side copy of the subtree arithmetic would be a second implementation, and the
 * first disagreement would leave a manager looking at the wrong total. If the endpoint cannot answer, the
 * panel says so and shows no figure.
 */
export const metadata: Metadata = {
  title: "Refusals — the control working",
  description:
    "Refusals (do_not_pay) by rule and by payer, with provenance. A refusal is not a failed payment — it is the control working.",
  robots: { index: false, follow: false, nocache: true },
};

const LIMIT = 5000;

export default async function RefusalsPage() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - REFUSAL_WINDOW_DAYS * 86_400_000);
  const query =
    "select=id,ts,source,payer,reason_codes,caller_provenance,tool" +
    "&decision=eq.do_not_pay" +
    `&ts=gte.${encodeURIComponent(windowStart.toISOString())}` +
    "&order=ts.desc" +
    `&limit=${LIMIT}`;

  // Two independent reads: the refusal rows and the #471 division total. The division total is the
  // endpoint's answer, not a second aggregation of these rows.
  const [result, division] = await Promise.all([
    selectRowsStrict<RefusalRow>("events", query),
    fetchRollup(rollupUnit(), { apiBase: rollupApiBase() }),
  ]);

  if (!result.ok) {
    return (
      <main className="lp refusals-page">
        <div className="lp-wrap refusals-wrap">
          <header className="refusals-hero">
            <p className="refusals-eyebrow">Lab · #472 · refusals</p>
            <h1>The refusals record could not be read.</h1>
            <p className="refusals-lede refusals-lede--hero">
              The events table returned <code>{result.reason}</code>
              {result.status === undefined ? "" : ` (HTTP ${result.status})`}. This page does not fall back to
              zero: an unreadable database and a quiet week are different facts.
            </p>
          </header>

          <RollupDivisionTotal state={division} />

          <p className="refusals-control" role="note">
            {REFUSAL_CONTROL_LINE}
          </p>

          <section className="refusals-panel" aria-labelledby="refusals-unreadable">
            <h2 id="refusals-unreadable">No figure is shown</h2>
            <p className="refusals-note">
              Requested window: {REFUSAL_WINDOW_DAYS} days from{" "}
              <code>{formatRefusalTime(windowStart.toISOString())}</code> to{" "}
              <code>{formatRefusalTime(now.toISOString())}</code>. Provenance is recorded per row in{" "}
              <code>events.source</code> and <code>caller_provenance</code>; this render read neither, so it
              states neither.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const view = buildRefusalView(result.rows, { days: REFUSAL_WINDOW_DAYS, now });

  return (
    <main className="lp refusals-page">
      <div className="lp-wrap">
        <RefusalsView
          view={view}
          truncated={result.rows.length >= LIMIT}
          division={<RollupDivisionTotal state={division} />}
        />
      </div>
    </main>
  );
}
