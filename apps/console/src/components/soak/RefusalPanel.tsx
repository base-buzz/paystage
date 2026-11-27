import { Panel } from "@/components/soak/Panel";
import { formatDay, formatInt, formatPayment, formatTime, formatTimestamp } from "@/lib/soak-mesh";
import type { SoakProjection } from "@/lib/soak-mesh-types";

function RefusalOverlay({ projection }: { projection: SoakProjection }) {
  const { heatmap, window, refusals } = projection;
  const width = 1000;
  const height = 150;
  const padLeft = 30;
  const padRight = 16;
  const baseline = height - 26;
  const maxDaily = Math.max(...heatmap.daily.map((day) => day.payments), 1);
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const span = Math.max(1, end - start);
  const x = (iso: string) => padLeft + ((Date.parse(iso) - start) / span) * (width - padLeft - padRight);
  const barWidth = (width - padLeft - padRight) / heatmap.daily.length;

  return (
    <figure className="mesh-refusal-figure">
      <svg
        className="mesh-refusal-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Daily paid payments as pale bars, with ${refusals.length} refusals marked in red near the start of the window.`}
      >
        <line x1={padLeft} y1={baseline} x2={width - padRight} y2={baseline} stroke="currentColor" strokeOpacity="0.22" />
        {heatmap.daily.map((day, index) => {
          const h = (day.payments / maxDaily) * (baseline - 34);
          return (
            <g key={day.date}>
              <rect
                x={padLeft + index * barWidth + barWidth * 0.14}
                y={baseline - h}
                width={barWidth * 0.72}
                height={h}
                rx={2}
                fill="#6ee7b7"
                fillOpacity={0.2}
                stroke="#6ee7b7"
                strokeOpacity={0.32}
              />
              <text className="mesh-refusal-day" x={padLeft + index * barWidth + barWidth / 2} y={baseline + 16} textAnchor="middle">
                {formatDay(day.date)}
              </text>
              <text className="mesh-refusal-day-n" x={padLeft + index * barWidth + barWidth / 2} y={baseline - h - 4} textAnchor="middle">
                {formatInt(day.payments)}
              </text>
            </g>
          );
        })}
        {refusals.map((refusal, index) => {
          const cx = x(refusal.at);
          const cy = 40 + (index % 10) * 5;
          return (
            <g key={`${refusal.at}-${refusal.wallet}`}>
              <line x1={cx} y1={cy} x2={cx} y2={baseline} stroke="#f06a6a" strokeOpacity={0.55} strokeWidth={1} />
              <circle cx={cx} cy={cy} r={3} fill="#f06a6a">
                <title>{`${formatTimestamp(refusal.at)} · ${refusal.wallet} → ${refusal.payeeShort} · ${refusal.decision}`}</title>
              </circle>
            </g>
          );
        })}
        <text className="mesh-refusal-callout" x={padLeft + 10} y={22}>
          {refusals.length} refusals, {formatTime(refusals[0]?.at ?? window.start)}–{formatTime(refusals.at(-1)?.at ?? window.start)} · they stack
          on one x position
        </text>
        <text className="mesh-refusal-axis" x={width - padRight} y={height - 4} textAnchor="end">
          bars = paid payments per day · red = refusals (no tx)
        </text>
      </svg>
      <figcaption>
        All {refusals.length} refusals fall inside the first two minutes of the window, so the timeline stacks them at one
        x position. The list is the honest view; a red field would imply a distribution the data does not have.
      </figcaption>
    </figure>
  );
}

export function RefusalPanel({ projection }: { projection: SoakProjection }) {
  const { refusals, counts, window } = projection;

  return (
    <Panel
      index={3}
      id="refusals"
      tone="refusal"
      title="Refusals"
      question="Did the policy path fire, and what did it stop?"
      proves="the policy path fired and left a record: ten pre-broadcast 'review' decisions, each with the rule that fired."
      doesNot="that a cap stopped ten payments that would otherwise have happened. The log records a decision, not a counterfactual."
      source={projection.source}
      windowStart={window.start}
      windowEnd={window.end}
    >
      <p className="mesh-lede">
        <strong>{refusals.length} refusals</strong> in the journal: rows whose <code>decision</code> is not <code>pay</code>.
        That is {refusals.length} out of {formatInt(counts.ledgerRows)} ledger rows, and <strong>0 of {formatInt(counts.withTx)}</strong>{" "}
        tx-bearing payments. Every one is <code>review</code>, and every one says the same thing: the payee was not in{" "}
        <code>allowed_pay_to</code>. None produced a transaction, so none has a tx hash and none can link to Basescan —
        they are listed rather than plotted as points, and the panel says so rather than drawing an empty field.
      </p>

      <div className="mesh-refusal-grid">
        <RefusalOverlay projection={projection} />
        <ol className="mesh-refusal-list" aria-label={`${refusals.length} refusals, each with no transaction`}>
          {refusals.map((refusal) => (
            <li key={`${refusal.at}-${refusal.wallet}-${refusal.payee}`}>
              <div className="mesh-refusal-top">
                <span className="mesh-refusal-time">{formatTimestamp(refusal.at)}</span>
                <span className="mesh-refusal-decision">{refusal.decision}</span>
              </div>
              <div className="mesh-refusal-flow">
                {refusal.wallet} → <span title={refusal.payee}>{refusal.payeeShort}</span> · {formatPayment(refusal.amount)}
              </div>
              <p className="mesh-refusal-reason">{refusal.reasons[0] ?? "no reason recorded"}</p>
              <p className="mesh-refusal-notx">No tx: refused before broadcast, so there is no transaction to link.</p>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
