import type { CSSProperties } from "react";
import {
  NO_COMPARABLE_DAY,
  SERIES_WINDOW_DAYS,
  formatMetricDelta,
  formatMetricValue,
  seriesSegments,
  type MarketMetric,
  type MarketSeries,
} from "@/lib/market-series";

/**
 * Movement for the market series (#322): the chart, the four day-over-day deltas, and the readiness gate.
 *
 * Two rules are enforced by construction rather than by copy:
 *
 * 1. **No line before seven consecutive days.** `series.metrics.coverage.ready` is the only branch that renders an
 *    `<svg>`; before that the panel states "N of 7 days collected" and today's value, because a line through one
 *    point is a drawing of an opinion.
 * 2. **A gap breaks the line.** The chart renders one polyline per `seriesSegments(...)` run; a day with no row
 *    starts a new run instead of being interpolated, and the caption names the dates that break it.
 *
 * The four delta cells render unconditionally. A non-comparable pair says "no comparable day" — it never borrows an
 * older point and never subtracts across a missing date.
 */

const LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const METRICS: Array<{ metric: MarketMetric; label: string }> = [
  { metric: "accepts", label: "Supply accepts" },
  { metric: "payeeTransfers", label: "Payee transfers" },
  { metric: "coverage", label: "Coverage" },
  { metric: "concentration", label: "Top-10 concentration" },
];

function DeltaCell({ series, metric, label }: { series: MarketSeries; metric: MarketMetric; label: string }) {
  const delta = series.metrics[metric].delta;
  const comparable = delta.comparable && delta.value !== null;
  return (
    <div style={{ minWidth: 132 }}>
      <div style={LABEL_STYLE}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, opacity: comparable ? 1 : 0.62 }}>
        {comparable ? formatMetricDelta(metric, delta.value) : NO_COMPARABLE_DAY}
      </div>
      <div style={{ fontSize: 11.5, opacity: 0.55, lineHeight: 1.4 }}>
        {comparable && delta.from !== null
          ? `vs ${delta.from} · was ${formatMetricValue(metric, delta.previous)}`
          : (delta.reason ?? "not enough history to compare")}
      </div>
    </div>
  );
}

/**
 * One SVG polyline per contiguous run of usable values.
 *
 * X is the calendar index, not the array of present values, so a missing day occupies its own horizontal space and
 * the two runs do not slide together into a join that never happened.
 */
function CoverageChart({ series }: { series: MarketSeries }) {
  const coverage = series.metrics.coverage;
  const points = coverage.points;
  const segments = seriesSegments(points);
  const values = points.map((point) => point.value).filter((value): value is number => value !== null);
  const missingDates = points.filter((point) => point.value === null).map((point) => point.runDate);

  if (points.length === 0 || values.length === 0) {
    return <p style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>No coverage value has been measured yet.</p>;
  }

  const width = 640;
  const height = 132;
  const pad = 10;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) =>
    pad + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - pad * 2));
  const y = (value: number) =>
    max === min ? height / 2 : height - pad - ((value - min) / (max - min)) * (height - pad * 2);

  return (
    <figure style={{ margin: "10px 0 0" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Coverage over ${points.length} calendar day(s) in ${segments.length} segment(s)`}
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1"
        />
        {segments.map((segment) => {
          const polyline = segment
            .map((entry) => `${x(entry.index).toFixed(1)},${y(entry.point.value!).toFixed(1)}`)
            .join(" ");
          return (
            <g key={segment[0]!.point.runDate}>
              <polyline
                points={polyline}
                fill="none"
                stroke="var(--lp-mint, #047857)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {segment.map((entry) => (
                <circle
                  key={entry.point.runDate}
                  cx={x(entry.index)}
                  cy={y(entry.point.value!)}
                  r={entry.index === points.length - 1 ? 3.5 : 2.2}
                  fill="var(--lp-mint, #047857)"
                />
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: 11, opacity: 0.55, marginTop: 3, lineHeight: 1.5 }}>
        Coverage per calendar day · {coverage.consecutiveDays} consecutive day(s)
        {missingDates.length > 0
          ? ` · line breaks on ${missingDates.join(", ")} — no readable coverage that day, not a zero`
          : ""}
      </figcaption>
    </figure>
  );
}

export function MarketMovementPanel({ series, reason }: { series: MarketSeries | null; reason: string | null }) {
  if (series === null) {
    return (
      <p style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.6, color: "var(--lp-amber, #b45309)" }}>
        <strong>Could not build the market series.</strong> {reason ?? "one of the two market tables could not be read"}
        . No line and no delta is shown, because a failed read is not a missing day.
      </p>
    );
  }

  const coverage = series.metrics.coverage;
  return (
    <div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.6 }}>
          Movement · day over day
        </div>
        <div style={{ fontSize: 12, opacity: 0.55 }}>
          {series.daysCollected} day(s) with a row in the last {series.points.length} calendar day(s)
        </div>
      </div>

      {coverage.ready ? (
        <CoverageChart series={series} />
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 24, fontWeight: 620, lineHeight: 1.2 }}>
            {coverage.consecutiveDays} of {SERIES_WINDOW_DAYS} days collected
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, maxWidth: 700 }}>
            {coverage.latest !== null
              ? `Latest coverage ${formatMetricValue("coverage", coverage.latest.value)} on ${coverage.latest.runDate}. `
              : "No coverage value has been measured yet. "}
            No line is drawn until {SERIES_WINDOW_DAYS} consecutive days exist — a line through one point, or a delta
            against nothing, would be a movement this series has not measured.
          </p>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid rgba(128,128,128,0.22)",
        }}
      >
        {METRICS.map(({ metric, label }) => (
          <DeltaCell key={metric} series={series} metric={metric} label={label} />
        ))}
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 11.5, opacity: 0.55, lineHeight: 1.5 }}>
        A delta compares the latest measured day with the calendar day immediately before it. If that day has no row,
        or either value is unreadable, the cell says &quot;{NO_COMPARABLE_DAY}&quot; and no number is computed.
      </p>
    </div>
  );
}
