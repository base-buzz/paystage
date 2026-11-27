import { Panel } from "@/components/soak/Panel";
import { formatInt, formatTimestamp } from "@/lib/soak-mesh";
import type { SoakProjection } from "@/lib/soak-mesh-types";

export function ProvenancePanel({ projection }: { projection: SoakProjection }) {
  const { counts, window, source } = projection;

  return (
    <Panel
      index={5}
      id="provenance"
      tone="provenance"
      title="Provenance — this is our load"
      question="Who caused these payments, and what can the picture not tell you?"
      proves="the rail carried this volume with real tx hashes, the policy path fired, and the loop conserves. That is what the five panels are allowed to show."
      doesNot="that anyone wants this. Volume from our own load generator is evidence the system works; it is not demand, revenue or a user base."
      source={source}
      windowStart={window.start}
      windowEnd={window.end}
    >
      <p className="mesh-provenance-claim">A real market is Zipfian; this one is engineered.</p>

      <div className="mesh-provenance-grid">
        <div>
          <p>
            <strong>Source label: <code>{source}</code>.</strong> These are our load generator&apos;s addresses, not
            customers. The label this page uses is the one that records who caused the payments: <code>{source}</code>.
            The distinction that matters is labelled versus unlabelled, not shown versus hidden.
          </p>
          <p>
            The address set is the label: on-chain there is no header to set, so the set of {formatInt(counts.wallets)}{" "}
            payer ids and {formatInt(counts.payees)} payees is what identifies this traffic as ours. Every panel names the
            source and the window for that reason.
          </p>
        </div>
        <div>
          <dl className="mesh-provenance-facts">
            <div>
              <dt>Window</dt>
              <dd>
                {formatTimestamp(window.start)}
                <br />→ {formatTimestamp(window.end)} · {window.days} UTC days
              </dd>
            </div>
            <div>
              <dt>Snapshot</dt>
              <dd>
                <a href={projection.snapshotHref}>{projection.snapshotFile}</a> · dated {projection.snapshotDate}
              </dd>
            </div>
            <div>
              <dt>Journal lines</dt>
              <dd>{formatInt(counts.journalLines)}</dd>
            </div>
            <div>
              <dt>With a real tx</dt>
              <dd>{formatInt(counts.withTx)}</dd>
            </div>
            <div>
              <dt>Refusals, no tx</dt>
              <dd>{formatInt(counts.refusals)}</dd>
            </div>
            <div>
              <dt>Pay decisions, no tx</dt>
              <dd>{formatInt(counts.nonTxPay)} · not drawn</dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="mesh-provenance-note">
        What this page can say: the rail moved {formatInt(counts.withTx)} real transactions, the pre-broadcast policy path
        recorded {formatInt(counts.refusals)} refusals, and the value loop conserves. What it cannot say: that any of this
        is wanted. The shape is engineered because we engineered it; that is the point of the label, and it is why the two
        lines above sit under every panel.
      </p>
      <p className="mesh-provenance-note">
        No live host read at runtime: the console cannot see the host journal, so it renders the committed snapshot{" "}
        <a href={projection.snapshotHref}>{projection.snapshotFile}</a>. Regenerate it with the ops extractor; the checker
        fails if a row has no tx hash, if the window disagrees with the filename date, or if these aggregates stop summing
        to the rows.
      </p>
    </Panel>
  );
}
