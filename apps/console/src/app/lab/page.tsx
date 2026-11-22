import type { Metadata } from "next";
import "../landing.css";
import { MarketDemandPanel } from "@/components/MarketDemandPanel";
import { MarketMovementPanel } from "@/components/MarketMovementPanel";
import { MarketSupplyPanel } from "@/components/MarketSupplyPanel";
import { ChannelAttributionPanel } from "@/components/ChannelAttributionPanel";
import { groupByChannel } from "@/lib/channel-counts";
import { buildDemandView, type MarketDemandRow, type MarketSupplyRow } from "@/lib/market-demand";
import { buildMarketSeries } from "@/lib/market-series";
import { selectRowsStrict } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * /lab — the daily probe results.
 *
 * Unlinked and noindex: public because a trend anyone can check is worth more than a screenshot, but not a marketing page
 * and not in any agent-facing list.
 *
 * Read path: SERVER ONLY. `probe_runs` has RLS on with no policy, so the anon key reads zero rows. Every read goes through
 * `selectRowsStrict`, which uses the service key and reports *why* it could not read; a failure must never render as
 * "never run", because that is a truthful-looking lie about a probe that may have run every day for a month.
 */
export const metadata: Metadata = {
  title: "Lab — probe results",
  description: "Daily probe results: how findable PayStage is, what agents decide when asked to pay, and outreach outcomes.",
  robots: { index: false, follow: false },
};

type ProbeRow = {
  probe: string;
  run_at: string;
  headline: string | null;
  summary: Record<string, unknown> | null;
};

/**
 * This file is public; how the probes work is not.
 *
 * The label and the question each probe asks arrive **in the row** (`summary.label`, `summary.question`), written by the
 * ops-side ingest. Listing them here would publish our measurement method — which searches, which phrasing, which agents —
 * to anyone reading the repository, and that is the one part of /lab that has no reason to be public. The page renders what
 * the data says it is.
 */
const PROBES: Array<{ id: string; higherIsBetter: boolean }> = [
  { id: "discovery", higherIsBetter: true },
  { id: "decision", higherIsBetter: true },
  { id: "clients", higherIsBetter: true },
  { id: "supply", higherIsBetter: true },
  // Aggregate only: the page is public, and naming repositories whose payment paths are unguarded would turn a measurement
  // into a shaming list.
  { id: "outreach", higherIsBetter: false },
];

/** A neutral fallback for a probe whose row has not arrived with its wording yet. */
function labelOf(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * A number only renders when its control passed.
 *
 * The outreach measurement published 19.5% before four controls caught what was wrong with it. A page that prints a figure
 * whose control failed is that same mistake made permanent and public, so `controls_ok: false` renders as "controls
 * failed" — and an absent flag counts as failed, because unknown is not a licence to print a number.
 */
function headlineFor(probe: string, row: ProbeRow): string {
  const summary = (row.summary ?? {}) as Record<string, unknown>;
  if (probe === "outreach" && summary.controls_ok !== true) return "controls failed — no figure";
  return row.headline ?? "—";
}

/**
 * The discovery ratio over channels that can actually answer.
 *
 * The MCP Registry's search matches server *names*, so every phrase query there returns zero rows for every publisher — a
 * channel failure, not a loss. Counting those six rows in the ratio made a 5-of-6 result read as 5-of-12 on the page and in
 * the trend line, which is the same "number nobody can trust" problem the coverage line was added to fix. This reduces over
 * `answered !== false` channels only and returns null when the summary carries no per-channel breakdown.
 */
function comparableRatio(summary: Record<string, unknown> | undefined): { present: number; measured: number } | null {
  const by = (summary?.by_channel ?? null) as Record<string, { answered?: boolean; present?: number; measured?: number; planned?: number }> | null;
  if (!by) return null;
  const answerable = Object.values(by).filter((c) => c.answered !== false);
  if (answerable.length === 0) return null;
  const present = answerable.reduce((n, c) => n + (c.present ?? 0), 0);
  const measured = answerable.reduce((n, c) => n + (c.measured ?? c.planned ?? 0), 0);
  return measured > 0 ? { present, measured } : null;
}

/** "4/12" → 0.333. Null when the headline is not a ratio, so a non-numeric probe simply has no series. */
function ratioOf(headline: string | null): number | null {
  if (!headline) return null;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(headline.trim());
  if (!m) return null;
  const total = Number(m[2]);
  if (!Number.isFinite(total) || total === 0) return null;
  return Number(m[1]) / total;
}

const DAY = 86_400_000;

/** One point per day: the last run of that day, so a day with three runs does not zig-zag the line. */
function dailySeries(rows: ProbeRow[]): Array<{ day: string; value: number; headline: string; summary?: Record<string, unknown> }> {
  const byDay = new Map<string, ProbeRow>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.run_at) - Date.parse(b.run_at))) {
    byDay.set(row.run_at.slice(0, 10), row);
  }
  const out: Array<{ day: string; value: number; headline: string; summary?: Record<string, unknown> }> = [];
  for (const [day, row] of byDay) {
    const value = ratioOf(row.headline);
    if (value !== null) out.push({ day, value, headline: row.headline ?? "", summary: (row.summary ?? undefined) as Record<string, unknown> | undefined });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** The most recent point at or before `daysAgo` days back — the honest comparison for a sparse series. */
function valueAt(series: Array<{ day: string; value: number }>, daysAgo: number): number | null {
  const cutoff = Date.now() - daysAgo * DAY;
  let found: number | null = null;
  for (const point of series) {
    if (Date.parse(`${point.day}T00:00:00Z`) <= cutoff) found = point.value;
  }
  return found;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Delta({
  series,
  daysAgo,
  label,
  higherIsBetter,
}: {
  series: Array<{ day: string; value: number }>;
  daysAgo: number;
  label: string;
  higherIsBetter: boolean;
}) {
  const latest = series.at(-1)?.value ?? null;
  const before = valueAt(series, daysAgo);
  if (latest === null || before === null) {
    return (
      <div style={{ minWidth: 108 }}>
        <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
        <div style={{ fontSize: 13, opacity: 0.5 }} title={`no reading ${daysAgo === 1 ? "a day" : `${daysAgo} days`} ago yet — the series starts 2026-11-19`}>
          no data
        </div>
      </div>
    );
  }
  const diff = latest - before;
  const better = higherIsBetter ? diff > 0 : diff < 0;
  const colour = diff === 0 ? "var(--lp-dim, #8b90a0)" : better ? "var(--lp-mint, #047857)" : "var(--lp-red, #b91c1c)";
  const arrow = diff === 0 ? "=" : diff > 0 ? "↑" : "↓";
  return (
    <div style={{ minWidth: 108 }}>
      <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 13, color: colour, fontWeight: 600 }}>
        {arrow} {diff === 0 ? "flat" : `${diff > 0 ? "+" : ""}${Math.round(diff * 100)}pp`}
      </div>
      <div style={{ fontSize: 11, opacity: 0.5 }}>vs {pct(before)}</div>
    </div>
  );
}

/**
 * A sparkline, drawn with the points that exist.
 *
 * No chart library and no interpolation: a gap in the series is a gap in the line, because filling it would invent
 * measurements for days the probe did not run — the same rule as "never run", applied to a chart.
 */
function Sparkline({
  series,
  higherIsBetter,
}: {
  series: Array<{ day: string; value: number }>;
  higherIsBetter: boolean;
}) {
  if (series.length === 0) return <div style={{ height: 64, opacity: 0.5, fontSize: 13 }}>No points yet.</div>;
  const width = 640;
  const height = 64;
  const pad = 6;
  const span = Math.max(1, series.length - 1);
  const x = (i: number) => pad + (i / span) * (width - pad * 2);
  const y = (v: number) => height - pad - v * (height - pad * 2);
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const stroke = higherIsBetter ? "var(--lp-mint, #047857)" : "var(--lp-amber, #b45309)";

  return (
    <figure style={{ margin: "10px 0 0" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={`Trend over ${series.length} day(s)`}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
        <line x1={pad} y1={pad} x2={width - pad} y2={pad} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="3 4" />
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.value)} r={i === series.length - 1 ? 3.5 : 2.2} fill={stroke} />
        ))}
      </svg>
      <figcaption style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
        {series[0]?.day} → {series.at(-1)?.day} · {series.length} day(s) measured
        {higherIsBetter ? " · higher is better" : " · lower is better"}
      </figcaption>
    </figure>
  );
}

function Panel({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 10,
        border: `1px ${tone === "warn" ? "solid var(--lp-amber, #b45309)" : "dashed var(--lp-line, #6b7280)"}`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The market half of the page: what sellers advertise, and what they actually receive.
 *
 * Two reads, not one, because they come from different sources and fail independently — a day can have a catalogue with no on-chain window, or the reverse, and the page must be able to
 * say which half is missing rather than drawing a zero.
 */
type SupplyRow = MarketSupplyRow & {
  resources?: number | string | null;
  accepts?: number | string | null;
  hosts?: number | string | null;
  median_price_usdc?: number | string | null;
  p90_price_usdc?: number | string | null;
  top_payees?: unknown;
  networks?: Record<string, number>;
};

/**
 * Read a window of daily rows, not one row.
 *
 * #322 needs the calendar, and the weekday-to-weekday movement the panel states cannot be recovered from the latest
 * row alone. Thirty rows is enough for a seven-day gate plus the gaps that make it unready; it is a cap on page work,
 * not a claim that older days do not exist.
 */
async function readMarketRows<T>(table: "market_supply" | "market_demand"): Promise<{ rows: T[]; reason: string | null }> {
  const result = await selectRowsStrict<T>(table, "select=*&order=run_date.desc&limit=30");
  if (!result.ok) return { rows: [], reason: marketReason(table, result.reason) };
  return { rows: result.rows, reason: null };
}

/**
 * Channel counts (#326): the newest seven days of `events`, grouped in the application.
 *
 * `source=eq.real` keeps our own demo and loadgen labels out of a "which listing sent anyone" number. The query uses
 * `events_source_ts_idx (source, ts)`; grouping in JS is why no new index was added. Ten thousand rows is a page cap,
 * not a claim about the window — when the cap is hit the panel says the counts are a floor.
 */
const CHANNEL_WINDOW_DAYS = 7;
const CHANNEL_ROW_CAP = 10_000;

type ChannelEventRow = { channel: string | null };

async function readChannels(): Promise<{
  rows: ChannelEventRow[];
  reason: string | null;
  truncated: boolean;
}> {
  const since = new Date(Date.now() - CHANNEL_WINDOW_DAYS * DAY).toISOString();
  const result = await selectRowsStrict<ChannelEventRow>(
    "events",
    `select=channel&ts=gte.${encodeURIComponent(since)}&source=eq.real&order=ts.desc&limit=${CHANNEL_ROW_CAP}`,
  );
  if (!result.ok) return { rows: [], reason: channelReason(result.reason), truncated: false };
  return { rows: result.rows, reason: null, truncated: result.rows.length >= CHANNEL_ROW_CAP };
}

/** A read failure names `events`, not `probe_runs`: a reason that names the wrong table is a small lie here. */
function channelReason(reason: string): string {
  if (reason === "no_service_key") {
    return "SUPABASE_SERVICE_ROLE_KEY is not set, so the service-key read of events is refused.";
  }
  return REASON_TEXT[reason] ?? "unreadable";
}

async function read(probe: string, limit: number) {
  return selectRowsStrict<ProbeRow>(
    "probe_runs",
    `select=probe,run_at,headline,summary&probe=eq.${probe}&order=run_at.desc&limit=${limit}`,
  );
}

const REASON_TEXT: Record<string, string> = {
  not_configured: "Supabase is not configured in this environment. A configuration fault, not an empty trend.",
  no_service_key:
    'SUPABASE_SERVICE_ROLE_KEY is not set. `probe_runs` has RLS on with no policy, so reading with the anon key returns zero rows — which would render as "never run" and be wrong.',
  forbidden: "The service key was refused for this table (401/403). The rows exist; this environment cannot read them.",
  unreachable: "The database could not be reached. No conclusion about the probes can be drawn from this page right now.",
};

/**
 * The probe wording names `probe_runs`; the market tables have the same RLS shape but a different name, and a reason
 * that names the wrong table is a small lie in the one place the page is explaining why it cannot show a number.
 */
function marketReason(table: "market_supply" | "market_demand", reason: string): string {
  if (reason === "no_service_key") {
    return `SUPABASE_SERVICE_ROLE_KEY is not set. ${table} has RLS on with no policy, so reading with the anon key returns zero rows — which would render as "no row" and be wrong.`;
  }
  return REASON_TEXT[reason] ?? "unreadable";
}

export default async function LabPage() {
  const data = await Promise.all(
    PROBES.map(async (p) => {
      const result = await read(p.id, 120);
      const rows = result.ok ? result.rows : [];
      const meta = (rows[0]?.summary ?? {}) as Record<string, unknown>;
      return {
        ...p,
        label: typeof meta.label === "string" ? meta.label : labelOf(p.id),
        question: typeof meta.question === "string" ? meta.question : null,
        failure: result.ok ? null : result.reason,
        status: result.ok ? null : result.status ?? null,
        rows,
        series: dailySeries(rows),
      };
    }),
  );

  const [supplyMarket, demandMarket, channelRead] = await Promise.all([
    readMarketRows<SupplyRow>("market_supply"),
    readMarketRows<MarketDemandRow>("market_demand"),
    readChannels(),
  ]);
  const channelCounts = channelRead.reason === null ? groupByChannel(channelRead.rows) : null;

  /**
   * Coverage's denominator is the catalogue's payee count for the demand row's *own* date.
   *
   * The series reads every recent catalogue row, and `buildDemandView` matches the latest demand row against the
   * catalogue row with the same `run_date`. If that day's catalogue row is missing the panel says coverage has no
   * denominator; it never borrows yesterday's.
   */
  const demandView = buildDemandView(
    {
      demand:
        demandMarket.rows.length > 0
          ? { ok: true, rows: demandMarket.rows }
          : demandMarket.reason !== null
            ? { ok: false, reason: demandMarket.reason }
            : { ok: true, rows: [] },
      supply:
        supplyMarket.rows.length > 0
          ? { ok: true, rows: supplyMarket.rows }
          : supplyMarket.reason !== null
            ? { ok: false, reason: supplyMarket.reason }
            : { ok: true, rows: [] },
    },
    Date.now(),
  );

  /**
   * The series is only built when both tables read cleanly. A failed read is not a missing day: building a series from
   * the half that answered would draw a gap exactly where the page cannot see, which is the failure #322 exists to
   * prevent. The movement panel says which read failed instead.
   */
  const marketSeriesReason = supplyMarket.reason ?? demandMarket.reason;
  const marketSeries =
    marketSeriesReason === null ? buildMarketSeries({ supply: supplyMarket.rows, demand: demandMarket.rows }) : null;
  const latestSupply = supplyMarket.rows[0] ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const measured = data.filter((p) => p.series.length > 0);
  const stale = measured.filter((p) => {
    const last = p.series.at(-1)?.day;
    return last !== undefined && Date.now() - Date.parse(`${last}T00:00:00Z`) > 2 * DAY;
  });

  return (
    <main className="lp-shell" style={{ maxWidth: 980, margin: "0 auto", padding: "96px 24px 64px" }}>
      <p style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.6 }}>Lab · unlisted</p>
      <h1 style={{ fontSize: 34, margin: "8px 0 12px" }}>Probe results</h1>
      <p style={{ opacity: 0.75, maxWidth: 720, lineHeight: 1.6 }}>
        {PROBES.length} questions asked on a schedule, and the answers kept as they were given. The block below is the signal: each
        probe&apos;s latest score and how it moved against the previous day, week, month and quarter. Where there is not
        enough history for a comparison, it says so rather than drawing a flat line.
      </p>

      {/* ---- the signal ---- */}
      <section style={{ marginTop: 28, padding: 18, borderRadius: 12, border: "1px solid var(--lp-line, #6b7280)" }}>
        <h2 style={{ fontSize: 15, margin: 0, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.65 }}>
          Are we scoring better or worse?
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, marginTop: 16 }}>
          {data.map((p) => {
            const latest = p.series.at(-1) ?? null;
            return (
              <div key={`signal-${p.id}`}>
                <div style={{ fontSize: 13, opacity: 0.6 }}>{p.label}</div>
                <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.2 }}>
                  {/*
                    Supply is a denominator, not a score: 1,223 payees over 24,078 accepts is a shape of the market, and rendered as "5%" it reads as a
                    failing grade next to four real ones. The number that means something there is the count of payees, so that is what the tile shows.
                  */}
                  {p.failure !== null
                    ? "\u2014"
                    : !latest
                      ? "never run"
                      : p.id === "supply"
                        ? (() => {
                            const [payees, accepts] = String(latest.headline).split("/");
                            return `${Number(payees).toLocaleString("en-US")} payees`;
                          })()
                        : pct(latest.value)}
                </div>
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8 }}>
                  {latest
                    ? (() => {
                        const npm = p.id === "discovery" ? (latest.summary?.by_channel as { npm?: { present?: number; measured?: number; planned?: number } } | undefined)?.npm : undefined;
                        /**
                         * The tile is a time series, so its percentage stays the stored ratio — a history that switches denominators halfway reads as a movement that did not happen.
                         * The channel figure rides in the label, where the sentence beside it can explain it.
                         */
                        return npm && typeof npm.present === "number"
                          ? `${latest.headline} · ${npm.present}/${npm.measured ?? npm.planned} npm · ${latest.day}`
                          : `${latest.headline} \u00b7 ${latest.day}`;
                      })()
                    : p.failure !== null
                      ? "could not read"
                      : "no measurement yet"}
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <Delta series={p.series} daysAgo={1} label="day" higherIsBetter={p.higherIsBetter} />
                  <Delta series={p.series} daysAgo={7} label="week" higherIsBetter={p.higherIsBetter} />
                  <Delta series={p.series} daysAgo={30} label="month" higherIsBetter={p.higherIsBetter} />
                  <Delta series={p.series} daysAgo={90} label="quarter" higherIsBetter={p.higherIsBetter} />
                </div>
              </div>
            );
          })}
        </div>
        {stale.length > 0 ? (
          <p style={{ marginTop: 14, fontSize: 13, color: "var(--lp-amber, #b45309)" }}>
            Stale: {stale.map((p) => p.label).join(", ")} — no run in the last 48 hours. The score above is the last
            measurement, not today&apos;s.
          </p>
        ) : null}
      </section>

      {/* ---- supply: what sellers advertise ---- */}
      <section style={{ marginTop: 28, padding: 18, borderRadius: 12, border: "1px solid var(--lp-line, #6b7280)" }}>
        <h2 style={{ fontSize: 15, margin: 0, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.65 }}>
          What sellers advertise
        </h2>

        {latestSupply ? (
          <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
            <strong>{Number(latestSupply.resources).toLocaleString("en-US")}</strong> resources across{" "}
            <strong>{Number(latestSupply.accepts).toLocaleString("en-US")}</strong> accepts, from{" "}
            <strong>{Number(latestSupply.payees).toLocaleString("en-US")}</strong> distinct payees on{" "}
            {Number(latestSupply.hosts).toLocaleString("en-US")} hosts
            {latestSupply.median_price_usdc != null ? (
              <>
                {" "}
                · median ask <strong>{Number(latestSupply.median_price_usdc).toLocaleString("en-US")} USDC</strong>, p90{" "}
                {Number(latestSupply.p90_price_usdc ?? 0).toLocaleString("en-US")}
              </>
            ) : null}
            . Read {latestSupply.run_date}. A catalogue entry is a seller&apos;s claim, not a probe of that seller — we have not paid these endpoints.
          </p>
        ) : (
          <p style={{ marginTop: 12, fontSize: 14, opacity: 0.8 }}>
            No catalogue reading stored{supplyMarket.reason ? ` — ${supplyMarket.reason}` : ""}. Half the market picture is missing; the demand panel below is unaffected.
          </p>
        )}

        <MarketSupplyPanel rows={supplyMarket.rows} reason={supplyMarket.reason} />
      </section>

      {/* ---- demand: what listed sellers are actually paid ---- */}
      <section style={{ marginTop: 28, padding: 18, borderRadius: 12, border: "1px solid var(--lp-line, #6b7280)" }}>
        <h2 style={{ fontSize: 15, margin: 0, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.65 }}>
          What sellers receive, measured daily
        </h2>
        <MarketMovementPanel series={marketSeries} reason={marketSeriesReason} />
        <MarketDemandPanel view={demandView} />
      </section>

      {/* ---- channel: which listing sent anyone ---- */}
      <ChannelAttributionPanel
        counts={channelCounts}
        reason={channelRead.reason}
        windowLabel={`the last ${CHANNEL_WINDOW_DAYS} days`}
        truncated={channelRead.truncated}
      />

      {/* ---- per probe ---- */}
      {data.map((p) => {
        const latestRow = p.rows[0];
        const summary = (latestRow?.summary ?? {}) as Record<string, unknown>;
        const queries = Array.isArray(summary.queries) ? (summary.queries as Array<Record<string, unknown>>) : null;
        const agents = Array.isArray(summary.agentsDetail) ? (summary.agentsDetail as Array<Record<string, unknown>>) : null;
        /** Per-channel answer state, needed by the table as well as the ratio note below it. */
        const by = (summary.by_channel ?? {}) as Record<string, { answered?: boolean; present?: number; measured?: number; planned?: number }>;

        return (
          <section key={p.id} style={{ marginTop: 44 }}>
            <h2 style={{ fontSize: 22, marginBottom: 4 }}>{p.label}</h2>
            {p.question !== null ? <p style={{ opacity: 0.7, marginTop: 0, maxWidth: 720 }}>{p.question}</p> : null}

            {p.failure !== null ? (
              <Panel tone="warn">
                <strong>Could not read.</strong> {REASON_TEXT[p.failure]}
                {p.status !== null ? ` (HTTP ${p.status})` : ""}
              </Panel>
            ) : p.rows.length === 0 ? (
              <Panel>
                <strong>Never run.</strong> No row exists for this probe, so there is no number to show — a zero here would
                be an invented measurement.
              </Panel>
            ) : (
              <>
                <Sparkline
                  series={
                    p.id === "discovery"
                      ? p.series.map((point) => {
                          const comparable = comparableRatio(point.summary);
                          return comparable ? { ...point, value: comparable.present / comparable.measured } : point;
                        })
                      : p.series
                  }
                  higherIsBetter={p.higherIsBetter}
                />

                {latestRow ? (
                  <p style={{ marginTop: 10, fontSize: 15 }}>
                    <strong>
                      {(() => {
                        const comparable = p.id === "discovery" ? comparableRatio(latestRow.summary as Record<string, unknown>) : null;
                        return comparable ? `${comparable.present} of ${comparable.measured} answerable queries` : headlineFor(p.id, latestRow);
                      })()}
                    </strong>{" "}
                    <span style={{ opacity: 0.6, fontSize: 13 }}>
                      latest run {latestRow.run_at.slice(0, 10)} · {p.rows.length} run(s) stored
                    </span>
                  </p>
                ) : null}

                {p.id === "discovery" && typeof summary.coverage === "number" ? (
                  <p style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
                    Coverage {summary.coverage}% — {String(summary.measured)} of {String(summary.planned)} planned queries
                    measured
                    {summary.excluded ? `, ${String(summary.excluded)} excluded after retries` : ""}. A shrunken denominator
                    changes the ratio, so it is printed beside it.
                    {(() => {
                      // A channel that cannot answer a phrase query is not a channel we lost on — say so where the ratio is read.
                      const npm = by?.npm;
                      const silent = Object.entries(by ?? {}).filter(([id, c]) => id !== "npm" && c.answered === false);
                      if (!npm || silent.length === 0) return null;
                      return (
                        <>
                          {" "}
                          The ratio is <strong>{npm.present} of {npm.measured ?? npm.planned}</strong> on npm phrase searches; the{" "}
                          {silent.map(([id]) => (id === "mcp-registry" ? "MCP Registry" : id)).join(", ")} matches names,
                          so a phrase query there returns nothing for anybody and its queries are not losses.
                        </>
                      );
                    })()}
                  </p>
                ) : null}

                {queries !== null ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ textAlign: "left", opacity: 0.6 }}>
                        <th style={{ padding: "6px 8px" }}>channel</th>
                        <th style={{ padding: "6px 8px" }}>query an agent might run</th>
                        <th style={{ padding: "6px 8px" }}>found</th>
                        <th style={{ padding: "6px 8px" }}>rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queries.map((q, i) => (
                        <tr
                          key={`${String(q.channel)}-${String(q.query)}-${i}`}
                          style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}
                        >
                          <td style={{ padding: "6px 8px", opacity: 0.75 }}>{String(q.channel)}</td>
                          <td style={{ padding: "6px 8px" }}>{String(q.query)}</td>
                          {(() => {
                            /**
                             * A channel whose search cannot answer a phrase query returns zero rows for every publisher. Painting
                             * that row the same red as a real loss made six "cannot answer"s read as six misses.
                             */
                            const channel = by[String(q.channel)];
                            const cannotMatch = channel !== undefined && channel.answered === false;
                            return (
                              <>
                                <td
                                  style={{
                                    padding: "6px 8px",
                                    color: cannotMatch
                                      ? "var(--lp-dim, #6b7280)"
                                      : q.present
                                        ? "var(--lp-mint, #047857)"
                                        : "var(--lp-red, #b91c1c)",
                                  }}
                                >
                                  {cannotMatch ? "cannot match" : q.present ? "yes" : "no"}
                                </td>
                                <td style={{ padding: "6px 8px", opacity: 0.75 }}>
                                  {cannotMatch ? "n/a" : q.rank === null ? "\u2014" : String(q.rank)}
                                </td>
                              </>
                            );
                          })()}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {agents !== null ? (
                  <>
                  <p style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
                    {(() => {
                      const answered = agents.filter((a) => a.decision !== null && a.decision !== undefined).length;
                      const silent = agents.length - answered;
                      return `${answered} of ${agents.length} agents answered; ${silent} did not. A silent agent is a coverage gap, not a refusal — the count is not a safety score.`;
                    })()}
                  </p>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ textAlign: "left", opacity: 0.6 }}>
                        <th style={{ padding: "6px 8px" }}>agent</th>
                        <th style={{ padding: "6px 8px" }}>state</th>
                        <th style={{ padding: "6px 8px" }}>decision</th>
                        <th style={{ padding: "6px 8px" }}>checks named</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((a, i) => (
                        <tr key={`${String(a.site)}-${i}`} style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
                          <td style={{ padding: "6px 8px" }}>{String(a.site)}</td>
                          <td style={{ padding: "6px 8px", opacity: 0.75 }}>{String(a.state)}</td>
                          <td style={{ padding: "6px 8px" }}>
                            {a.decision === null || a.decision === undefined ? (
                              // "2/6" is a coverage fact, not a refusal rate: four agents never answered, and a dash
                              // invites the reader to assume they refused. Say what happened.
                              <span style={{ opacity: 0.6 }}>
                                {/* A page that never rendered a composer was never asked: our harness, not the agent. */}
                                {a.state === "no-composer" ? "never asked — the page had no composer" : `did not answer (${String(a.state)})`}
                              </span>
                            ) : (
                              String(a.decision)
                            )}
                          </td>
                          <td style={{ padding: "6px 8px", opacity: 0.75 }}>{a.checks === null ? "\u2014" : String(a.checks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </>
                ) : null}

                {p.id === "supply" ? (
                  <>
                    <p style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
                      {Number(summary.payees ?? 0).toLocaleString("en-US")} distinct payees across{" "}
                      {Number(summary.accepts ?? 0).toLocaleString("en-US")} accepts, from{" "}
                      {Number(summary.advertised ?? 0).toLocaleString("en-US")} advertised resources on {String(summary.networks ?? "?")} networks.{" "}
                      <strong style={{ color: summary.flagged ? "var(--lp-red, #b91c1c)" : "inherit" }}>
                        {/* Membership in a denial list is a lookup, not a judgement — the note says "on our denial lists" for the same reason. */}
                        {String(summary.flagged ?? 0)} on our denial lists
                      </strong>
                      . Aggregate only — this page never names a seller. It is a catalogue read on the date shown, not a probe of each seller: a listing is a seller's claim.
                    </p>
                    {Array.isArray(summary.top_networks) ? (
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13.5 }}>
                        <thead>
                          <tr style={{ textAlign: "left", opacity: 0.6 }}>
                            <th style={{ padding: "6px 8px" }}>network</th>
                            <th style={{ padding: "6px 8px" }}>accepts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(summary.top_networks as Array<{ network: string; count: number }>).map((n) => (
                            <tr key={n.network} style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
                              <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{n.network}</td>
                              <td style={{ padding: "6px 8px" }}>{n.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    <p style={{ marginTop: 8, fontSize: 12.5, opacity: 0.6 }}>
                      Zero flagged is not a clean bill of health: our lists are 24 curated addresses against {String(summary.payees ?? "?")}{" "}
                      payees. The coverage fact that matters is how much of this market a policy cannot express at all — Solana and bare
                      network labels are counted here, not averaged away.
                    </p>
                  </>
                ) : null}

                {p.id === "clients" ? (
                  <>
                    {/* The label is not decoration: the note claims this traffic is labelled synthetic wherever it is quoted, and
                        until this line existed /lab was a surface where it was not. */}
                    <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, opacity: 0.7 }}>
                      <strong>Synthetic testnet traffic — not customers, not revenue.</strong> 100 independent wallets paying each
                      other with test USDC on Base Sepolia. It shows the harness works.
                    </p>
                    {(summary.failure_window as { first?: string; last?: string } | null)?.first ? (
                      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12.5, opacity: 0.7 }}>
                        {/* A cumulative count beside a rising total reads as "still failing": name the window. */}
                        Failures are cumulative: all{" "}
                        {String(summary.failed ?? 0)} so far happened between{" "}
                        {String((summary.failure_window as { first: string }).first).slice(11, 16) + "Z"} and{" "}
                        {String((summary.failure_window as { last?: string }).last ?? (summary.failure_window as { first: string }).first).slice(11, 16) + "Z"}
                        {summary.last_tick_at ? `; the harness last ticked at ${String(summary.last_tick_at).slice(11, 16)}Z` : ""}.
                      </p>
                    ) : null}

                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, fontSize: 13.5 }}>
                      {[
                        ["sent", summary.sent, "var(--lp-mint, #047857)"],
                        ["refused by policy", summary.refused, "var(--lp-dim, #8b90a0)"],
                        ["failed", summary.failed, summary.failed ? "var(--lp-red, #b91c1c)" : "var(--lp-dim, #8b90a0)"],
                        ["dry runs", summary.dry_runs, "var(--lp-dim, #8b90a0)"],
                        ["wallets active", summary.wallets_active, undefined],
                      ].map(([label, value, colour]) => (
                        <div key={String(label)}>
                          <div style={{ opacity: 0.55, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>{String(label)}</div>
                          <div style={{ fontSize: 18, fontWeight: 600, color: (colour as string | undefined) ?? "inherit" }}>{String(value ?? 0)}</div>
                        </div>
                      ))}
                    </div>

                    {summary.failure_classes && Object.keys(summary.failure_classes as Record<string, number>).length > 0 ? (
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 13.5 }}>
                        <thead>
                          <tr style={{ textAlign: "left", opacity: 0.6 }}>
                            <th style={{ padding: "6px 8px" }}>failure class</th>
                            <th style={{ padding: "6px 8px" }}>count</th>
                            <th style={{ padding: "6px 8px" }}>what it means</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(summary.failure_classes as Record<string, number>).map(([cls, count]) => (
                            <tr key={cls} style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
                              <td style={{ padding: "6px 8px", color: "var(--lp-red, #b91c1c)" }}>{cls}</td>
                              <td style={{ padding: "6px 8px" }}>{count}</td>
                              <td style={{ padding: "6px 8px", opacity: 0.75 }}>
                                {{
                                  "insufficient funds": "a wallet ran dry — funding, not a product defect",
                                  "nonce too low": "two payments collided from one wallet — concurrency bug in the harness",
                                  "RPC rate limit": "too many in flight — lower --concurrency",
                                  "RPC timeout": "the endpoint did not answer — retry policy question",
                                  "gas estimation": "the transfer would have reverted — balance or allowance",
                                  network: "transport — endpoint or DNS",
                                  other: "unnormalised; read the journal",
                                }[cls] ?? "unnormalised"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>No failures recorded.</p>
                    )}

                    <p style={{ marginTop: 10, fontSize: 12.5, opacity: 0.6 }}>
                      versions producing traffic:{" "}
                      {Object.entries((summary.versions ?? {}) as Record<string, number>).map(([v, n]) => `${v} ×${n}`).join(", ") || "none"} ·
                      a refusal is the policy working, a failure is not
                    </p>
                  </>
                ) : null}

                {p.id === "outreach" ? (
                  <p style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
                    Sample {String(summary.sampled ?? "\u2014")} of {String(summary.universe ?? "\u2014")} · callers{" "}
                    {String(summary.callers ?? "\u2014")} · controls {summary.controls_ok === true ? "passed" : "failed"} ·
                    contacts filed {String(summary.contacts_filed ?? "0")}. Aggregate only: this page never names a
                    repository whose payment path is unguarded.
                    {/*
                      The classifier changed on 2026-11-19 and the number fell with it. A page that shows the new ratio without saying the rule moved is worse than one that shows the old
                      one, so the rule and its date travel with the number.
                    */}
                    {" "}
                    <span style={{ opacity: 0.8 }}>
                      From 2026-11-19: a call site counts only when a buyer invocation appears outside the test, examples and
                      scripts directories, and a repository whose gate cannot be classified counts as <em>gated-unknown</em> in the
                      denominator. Under the earlier rule this same panel read 52 of 94; under this one it reads 35 of 81.
                    </span>
                  </p>
                ) : null}
              </>
            )}
          </section>
        );
      })}

      {/* ---- how to read it ---- */}
      <section style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: 15, margin: 0, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.65 }}>
          Reading this page
        </h2>
        <ul style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.7, opacity: 0.8, paddingLeft: 20 }}>
          <li>
            <strong>Percentages are ratios of probes, not of users.</strong> &quot;3/10&quot; means three of ten searches
            returned us; it says nothing about how many agents called.
          </li>
          <li>
            <strong>A gap is not a zero.</strong> The line joins the days that ran; a missing day is a gap, and a probe
            that never ran says so.
          </li>
          <li>
            <strong>Each comparison uses the closest earlier point</strong> at or before that horizon, so a week delta with
            four days of history borrows the oldest day it has — the &quot;vs&quot; figure under each delta shows what it
            actually compared against.
          </li>
          <li>
            <strong>Registry discovery is structurally zero.</strong> The MCP registry searches server names only and
            truncates at 100 results, so ours cannot surface for a capability query however it is named. That is not a
            regression, and nothing on this page will fix it.
          </li>
          <li>
            <strong>Channel counts are events, not people.</strong> A row is one call that carried a listing token. The{" "}
            <em>unknown channel</em> row counts calls with no <code>?from=</code>; it is never folded into a known
            channel or labelled &quot;direct&quot;.
          </li>
          <li>
            <strong>Data as of {today}.</strong> Rows live in <code>probe_runs</code>, one per probe per run.
          </li>
        </ul>
      </section>
    </main>
  );
}
