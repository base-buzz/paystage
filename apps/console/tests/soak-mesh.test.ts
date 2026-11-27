import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MeshPage from "@/app/lab/mesh/page";
import { amountToMicro, conservation } from "@/lib/soak-mesh";

type Row = { at: string; wallet: string; payee: string; amount: string; decision: string; tx: string; window: string };
type Snapshot = {
  snapshotDate: string;
  source: string;
  window: { start: string; end: string; label: string; days: number };
  counts: Record<string, number>;
  totals: Record<string, number | string>;
  aggregates: {
    mesh: { left: Array<{ payments: number; micro: number }>; right: Array<{ payments: number; micro: number }>; edges: Array<{ count: number; micro: number }> };
    heatmap: { rows: Array<{ counts: number[]; total: number }>; hourly: number[]; daily: Array<{ payments: number }> };
  };
  rows: Row[];
  refusals: Array<{ decision: string; tx: string | null }>;
};

const ROOT = join(__dirname, "..");
const snapshot = JSON.parse(readFileSync(join(ROOT, "public/mesh/latest.json"), "utf8")) as Snapshot;
const projection = JSON.parse(readFileSync(join(ROOT, "src/lib/soak-mesh.generated.json"), "utf8")) as {
  counts: Record<string, number>;
  totals: Record<string, number | string>;
  mesh: Snapshot["aggregates"]["mesh"];
  heatmap: Snapshot["aggregates"]["heatmap"];
  samples: Array<{ tx: string; url: string }>;
};

describe("the mesh snapshot", () => {
  it("conserves value across rows, payer totals and payee totals", () => {
    const result = conservation(snapshot.rows);
    expect(result.payments).toBe(snapshot.rows.length);
    expect(result.payers).toBe(new Set(snapshot.rows.map((row) => row.wallet)).size);
    expect(result.payees).toBe(new Set(snapshot.rows.map((row) => row.payee)).size);
    expect(result.differenceMicro).toBe(0);
    expect(result.totalMicro).toBe(result.payerMicro);
    expect(result.totalMicro).toBe(result.payeeMicro);
    expect(result.totalMicro).toBe(snapshot.totals.amountMicro);
    expect(snapshot.totals.payerMicro).toBe(snapshot.totals.payeeMicro);
    expect(result.totalMicro).toBeGreaterThan(0);
  });

  it("draws only rows with a real tx hash", () => {
    expect(snapshot.rows.length).toBeGreaterThan(0);
    for (const row of snapshot.rows) {
      expect(row.tx).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(amountToMicro(row.amount)).toBeGreaterThan(0);
      expect(row.window).toBe(snapshot.window.label);
    }
    expect(new Set(snapshot.rows.map((row) => row.tx)).size).toBe(snapshot.rows.length);
  });

  it("has the aggregates sum back to the rows", () => {
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const mesh = snapshot.aggregates.mesh;
    const heatmap = snapshot.aggregates.heatmap;
    expect(sum(mesh.left.map((node) => node.payments))).toBe(snapshot.rows.length);
    expect(sum(mesh.right.map((node) => node.payments))).toBe(snapshot.rows.length);
    expect(sum(mesh.edges.map((edge) => edge.count))).toBe(snapshot.rows.length);
    expect(sum(mesh.edges.map((edge) => edge.micro))).toBe(snapshot.totals.amountMicro);

    expect(sum(heatmap.rows.map((row) => sum(row.counts)))).toBe(snapshot.rows.length);
    expect(sum(heatmap.rows.map((row) => row.total))).toBe(snapshot.rows.length);
    expect(sum(heatmap.hourly)).toBe(snapshot.rows.length);
    expect(sum(heatmap.daily.map((day) => day.payments))).toBe(snapshot.rows.length);

    // The page renders the projection; it must be the same aggregate object, not a hand-copied figure.
    expect(projection.mesh).toEqual(mesh);
    expect(projection.heatmap).toEqual(heatmap);
    expect(projection.counts).toEqual(snapshot.counts);
    expect(projection.totals).toEqual(snapshot.totals);
  });

  it("lists refusals as refusals, never as tx-bearing payments", () => {
    expect(snapshot.refusals.length).toBe(snapshot.counts.refusals);
    for (const refusal of snapshot.refusals) {
      expect(refusal.decision).not.toBe("pay");
      expect(refusal.tx).toBeNull();
    }
    for (const sample of projection.samples) {
      expect(sample.url).toBe(`https://sepolia.basescan.org/tx/${sample.tx}`);
    }
  });
});

describe("the mesh page", () => {
  it("server-renders the provenance, the tx links and both lines per panel", () => {
    const html = renderToStaticMarkup(createElement(MeshPage));
    expect(html).toContain("dev-loadgen");
    expect(html.toLowerCase()).toContain("a real market is zipfian; this one is engineered");
    expect(html).toContain("What it proves");
    expect(html).toContain("What it does not prove");
    expect(html).toContain("Basescan Sepolia");
    expect(html).toContain("https://sepolia.basescan.org/tx/");
    expect(html).toContain("No tx: refused before broadcast");
    expect(html).not.toContain("<script");
  });
});
