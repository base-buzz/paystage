import type { Metadata } from "next";

import "../../landing.css";
import "./mesh.css";

import { HeatmapPanel } from "@/components/soak/HeatmapPanel";
import { MeshPanel } from "@/components/soak/MeshPanel";
import { ProvenancePanel } from "@/components/soak/ProvenancePanel";
import { RefusalPanel } from "@/components/soak/RefusalPanel";
import { ValueFlowPanel } from "@/components/soak/ValueFlowPanel";
import soakMeshData from "@/lib/soak-mesh.generated.json";
import { asSoakProjection, formatEth, formatInt, formatTimestamp, percent } from "@/lib/soak-mesh";

/**
 * `/lab/mesh` — the soak drawn from its own transactions (#482).
 *
 * Five server-rendered panels, no client JavaScript. The input is a committed, dated snapshot written
 * by `ops/bin/soak-mesh-export.mjs`; the console cannot see the host journal, and deliberately does
 * not try. Every row rendered individually carries its tx hash and a Basescan Sepolia link; the ten
 * refusals carry no tx because nothing was broadcast, and the panel says that in words.
 *
 * The page is unlisted and noindex: it is evidence, not a marketing surface.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Mesh — the soak, drawn from its own transactions",
  description:
    "13,766 payments with real transaction hashes, drawn from a committed snapshot. Source: dev-loadgen; this is our load, not demand.",
  robots: { index: false, follow: false, nocache: true },
};

const soak = asSoakProjection(soakMeshData);

export default function MeshPage() {
  const { counts, totals, mesh, window, source } = soak;

  return (
    <main className="lp mesh-page">
      <div className="lp-wrap mesh-wrap">
        <header className="mesh-hero">
          <p className="mesh-eyebrow">Lab · #482 · the soak, drawn</p>
          <h1>{formatInt(counts.withTx)} payments, drawn from their own transactions.</h1>
          <p className="mesh-lede mesh-lede--hero">
            Every payment drawn below comes from a journal row with a real transaction hash:{" "}
            <strong>{formatInt(counts.withTx)}</strong> of {formatInt(counts.journalLines)} lines, from{" "}
            {formatInt(counts.wallets)} payer ids to {formatInt(counts.payees)} payees, between{" "}
            {formatTimestamp(window.start)} and {formatTimestamp(window.end)}. Source: <code>{source}</code>. Snapshot:{" "}
            <a href={soak.snapshotHref}>{soak.snapshotFile}</a>.
          </p>
          <p className="mesh-lede">
            Nothing is extrapolated, interpolated or padded. The mesh aggregates the tail into an <code>others</code>{" "}
            node and says so; the hour × payee panel aggregates {heatmapTail(soak)} payees and says so; the{" "}
            {formatInt(counts.refusals)} refusals are listed in red with their count instead of being drawn as a field.
            This is our own load, labelled <code>dev-loadgen</code>: it is evidence the rail and the policy path work, and
            it is not evidence that anyone wants this.
          </p>
          <dl className="mesh-hero-facts">
            <div>
              <dt>Payments with tx</dt>
              <dd>{formatInt(counts.withTx)}</dd>
            </div>
            <div>
              <dt>Distinct tx hashes</dt>
              <dd>{formatInt(counts.withTx)}</dd>
            </div>
            <div>
              <dt>Value conserved</dt>
              <dd>{formatEth(totals.amountMicro)} ETH</dd>
            </div>
            <div>
              <dt>Refusals</dt>
              <dd>{formatInt(counts.refusals)} · no tx</dd>
            </div>
            <div>
              <dt>Mesh</dt>
              <dd>
                {mesh.left.length + mesh.right.length} nodes · {mesh.edges.length} links
              </dd>
            </div>
            <div>
              <dt>Through others</dt>
              <dd>{percent(mesh.throughOthers.share)}</dd>
            </div>
          </dl>
        </header>

        <MeshPanel projection={soak} />
        <HeatmapPanel projection={soak} />
        <RefusalPanel projection={soak} />
        <ValueFlowPanel projection={soak} />
        <ProvenancePanel projection={soak} />

        <footer className="mesh-footer">
          <p>
            Built from <a href={soak.snapshotHref}>{soak.snapshotFile}</a> · {formatInt(counts.withTx)} rows with tx ·{" "}
            {formatInt(counts.refusals)} refusals without tx · window {window.label} · source <code>{source}</code>.
          </p>
          <p>
            Individual payments link to Basescan Sepolia; aggregate links and heatmap cells do not, because they are not
            payments. A refusal cannot link: it has no tx hash.
          </p>
        </footer>
      </div>
    </main>
  );
}

function heatmapTail(projection: typeof soak): number {
  const others = projection.heatmap.rows.find((row) => row.isOthers);
  return others?.members ?? 0;
}
