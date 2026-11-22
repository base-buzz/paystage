import {
  bazaarComparisonNotice,
  bazaarSampleDefinition,
  formatBazaarCalls,
  walkedDemandFigure,
  type BazaarDemandSnapshot,
} from "@/lib/bazaar-demand";
import type { DemandView } from "@/lib/market-demand";

/**
 * The two demand sources, side by side (#375).
 *
 * Left: what our own `eth_getLogs` walk over payees observed in its block window. Right: Bazaar's own call counter over
 * a sampled, stated slice of its catalogue. Each number carries its definition in the same column; the Bazaar label is
 * read from the generated snapshot's `note` field, never retyped here.
 *
 * There is deliberately no chart, ratio or combined total on this panel. The two figures describe different acts over
 * different windows, and a line joining them would be a movement neither source measured.
 */

const LABEL_STYLE = {
  fontSize: 11,
  opacity: 0.55,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

function Column({
  title,
  value,
  definition,
  children,
}: {
  title: string;
  value: string;
  definition: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ padding: 16, borderRadius: 10, border: "1px solid rgba(128,128,128,0.25)" }}>
      <div style={LABEL_STYLE}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 650, lineHeight: 1.15, marginTop: 2 }}>{value}</div>
      <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.55 }}>
        <strong>Definition:</strong> {definition}
      </p>
      {children}
    </div>
  );
}

export function DemandSourcesPanel({ view, bazaar }: { view: DemandView; bazaar: BazaarDemandSnapshot }) {
  const walked = walkedDemandFigure(view);
  const definition = bazaarSampleDefinition(bazaar);
  // The label is the collector's own note. An empty note withholds the counter instead of rendering a bare figure.
  const label = typeof bazaar.note === "string" && bazaar.note.trim() !== "" ? bazaar.note.trim() : null;
  const counter = label === null ? null : formatBazaarCalls(bazaar.totalCalls30d);
  const walkedBlocks = view.kind === "ready" ? view.snapshot.windowBlocks : null;

  return (
    <section style={{ marginTop: 18 }} aria-label="Two demand measurements, side by side">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        <Column
          title="Walked demand · our eth_getLogs over payees"
          value={walked.value === null ? "—" : walked.value.toLocaleString("en-US")}
          definition={walked.detail}
        />

        <Column
          title="Bazaar counters · l30DaysTotalCalls"
          value={counter ?? "—"}
          definition={definition}
        >
          {label === null ? (
            <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--lp-amber, #b45309)" }}>
              Counter withheld: the generated snapshot has no note, and a Bazaar counter is never shown without its
              label.
            </p>
          ) : (
            <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.55 }}>
              <strong>Label:</strong> {label}
            </p>
          )}
          <p style={{ margin: "6px 0 0", fontSize: 11.5, opacity: 0.55 }}>
            Sample measured {bazaar.measuredAt}.
          </p>
        </Column>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.55, opacity: 0.7 }}>
        {bazaarComparisonNotice(walkedBlocks)}
      </p>
    </section>
  );
}
