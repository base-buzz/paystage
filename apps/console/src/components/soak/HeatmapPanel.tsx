import { Panel } from "@/components/soak/Panel";
import { formatInt, formatTimestamp, shortAddress } from "@/lib/soak-mesh";
import type { SoakProjection } from "@/lib/soak-mesh-types";

function cellBackground(count: number, max: number, others: boolean): string {
  if (count === 0) return "transparent";
  const alpha = 0.06 + 0.72 * Math.sqrt(count / Math.max(1, max));
  return others ? `rgba(122, 162, 255, ${alpha.toFixed(3)})` : `rgba(110, 231, 183, ${alpha.toFixed(3)})`;
}

export function HeatmapPanel({ projection }: { projection: SoakProjection }) {
  const { heatmap, window } = projection;
  const minHourly = Math.min(...heatmap.hourly);
  const maxHourly = Math.max(...heatmap.hourly);
  const othersRow = heatmap.rows.find((row) => row.isOthers);
  const individualRows = heatmap.rows.filter((row) => !row.isOthers);

  return (
    <Panel
      index={2}
      id="heatmap"
      title="Hour × payee"
      question="Is the cadence structured or uniform?"
      proves="the rail carried a steady cadence: hourly totals stay between 499 and 626 payments, and the shape repeats across the ten days."
      doesNot="that the cadence is demand. A scheduler repeating at a steady rate is what engineered load looks like, not what a market looks like."
      source={projection.source}
      windowStart={window.start}
      windowEnd={window.end}
    >
      <p className="mesh-lede">
        Rows are the top {heatmap.topN} payees by payment count plus one aggregate row for the remaining{" "}
        {othersRow?.members ?? 0} payees. Columns are UTC hours, summed across the snapshot window. Each cell is a count
        of journal rows with a real tx hash; there is no interpolation, smoothing or padding. The individual rows
        share one colour scale (darkest cell {heatmap.maxCell}); the <code>others</code> row is scaled separately
        (darkest cell {heatmap.othersMaxCell}) because it aggregates many payees and would otherwise wash every other cell
        white.
      </p>

      <div className="mesh-heat-scroll">
        <div
          className="mesh-heat"
          style={{ gridTemplateColumns: `156px repeat(${heatmap.hours.length}, minmax(22px, 1fr))` }}
        >
          <div className="mesh-heat-corner">Payee</div>
          {heatmap.hours.map((hour) => (
            <div className="mesh-heat-hour" key={`h-${hour}`}>
              {String(hour).padStart(2, "0")}
            </div>
          ))}
          {individualRows.map((row) => (
            <div className="mesh-heat-row" key={row.id} style={{ display: "contents" }}>
              <div className="mesh-heat-label" title={row.id}>
                {shortAddress(row.id)}
              </div>
              {row.counts.map((count, hour) => (
                <div
                  className="mesh-heat-cell"
                  key={`${row.id}-${hour}`}
                  title={`${shortAddress(row.id)} · ${String(hour).padStart(2, "0")}:00 UTC · ${count} payment${count === 1 ? "" : "s"}`}
                  style={{ background: cellBackground(count, heatmap.maxCell, false) }}
                >
                  {count > 0 ? count : ""}
                </div>
              ))}
            </div>
          ))}
          {othersRow ? (
            <div className="mesh-heat-row" key="others" style={{ display: "contents" }}>
              <div className="mesh-heat-label mesh-heat-label--others">
                others · {othersRow.members} payees
              </div>
              {othersRow.counts.map((count, hour) => (
                <div
                  className="mesh-heat-cell mesh-heat-cell--others"
                  key={`others-${hour}`}
                  title={`${othersRow.members} payees · ${String(hour).padStart(2, "0")}:00 UTC · ${count} payments`}
                  style={{ background: cellBackground(count, heatmap.othersMaxCell, true) }}
                >
                  {count}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mesh-heat-label mesh-heat-label--total">hourly total</div>
          {heatmap.hourly.map((count, hour) => (
            <div
              className="mesh-heat-cell mesh-heat-cell--total"
              key={`total-${hour}`}
              title={`${String(hour).padStart(2, "0")}:00 UTC · ${formatInt(count)} payments`}
            >
              {formatInt(count)}
            </div>
          ))}
        </div>
      </div>

      <div className="mesh-heat-legend">
        <span>
          <i className="mesh-heat-swatch" style={{ background: cellBackground(heatmap.maxCell, heatmap.maxCell, false) }} /> individual payee
        </span>
        <span>
          <i className="mesh-heat-swatch" style={{ background: cellBackground(heatmap.othersMaxCell, heatmap.othersMaxCell, true) }} /> others aggregate
        </span>
        <span>
          hourly totals {formatInt(minHourly)}–{formatInt(maxHourly)} · sum {formatInt(heatmap.hourly.reduce((sum, n) => sum + n, 0))}
        </span>
        <span>
          window {formatTimestamp(window.paymentStart)} → {formatTimestamp(window.paymentEnd)}
        </span>
      </div>
    </Panel>
  );
}
