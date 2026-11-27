/**
 * The snapshot/projection contract for `/lab/mesh` (#482).
 *
 * `rows` exist only in the full snapshot under `apps/console/public/mesh/`. The page imports the
 * compact projection below; the checker recomputes every aggregate in it from those rows so the
 * projection can never drift from the data it claims to draw.
 */

export type SoakWindow = {
  start: string;
  end: string;
  label: string;
  days: number;
  paymentStart: string;
  paymentEnd: string;
};

export type SoakCounts = {
  journalLines: number;
  ledgerRows: number;
  withTx: number;
  refusals: number;
  nonTxPay: number;
  wallets: number;
  payees: number;
};

export type SoakTotals = {
  payments: number;
  amountMicro: number;
  amountEth: string;
  payerMicro: number;
  payeeMicro: number;
  differenceMicro: number;
  payers: number;
  payees: number;
  meanMicro: number;
  minMicro: number;
  maxMicro: number;
};

export type SoakMeshNode = {
  id: string;
  micro: number;
  payments: number;
  isOthers: boolean;
  members?: number;
};

export type SoakEdge = {
  from: string;
  to: string;
  count: number;
  micro: number;
};

export type SoakMesh = {
  topN: number;
  left: SoakMeshNode[];
  right: SoakMeshNode[];
  edges: SoakEdge[];
  throughOthers: { payments: number; share: number };
};

export type SoakHeatmapRow = {
  id: string;
  isOthers: boolean;
  members?: number;
  counts: number[];
  total: number;
};

export type SoakHeatmap = {
  topN: number;
  hours: number[];
  rows: SoakHeatmapRow[];
  maxCell: number;
  othersMaxCell: number;
  hourly: number[];
  daily: Array<{ date: string; payments: number; micro: number }>;
};

export type SoakRefusal = {
  at: string;
  wallet: string;
  payee: string;
  payeeShort: string;
  amount: string;
  decision: string;
  tx: string | null;
  reasons: string[];
  note: string;
};

export type SoakSample = {
  at: string;
  wallet: string;
  payee: string;
  payeeShort: string;
  amount: string;
  tx: string;
  url: string;
};

export type SoakProjection = {
  schema: number;
  snapshotDate: string;
  source: string;
  network: string;
  snapshotFile: string;
  snapshotHref: string;
  window: SoakWindow;
  counts: SoakCounts;
  totals: SoakTotals;
  mesh: SoakMesh;
  heatmap: SoakHeatmap;
  refusals: SoakRefusal[];
  samples: SoakSample[];
};

/** The subset of the full snapshot the checker reads; `rows` are deliberately not in the projection. */
export type SoakSnapshot = {
  schema: number;
  snapshotDate: string;
  source: string;
  network: string;
  window: SoakWindow;
  counts: SoakCounts;
  totals: SoakTotals;
  aggregates: {
    mesh: SoakMesh;
    heatmap: SoakHeatmap;
  };
  rows: Array<{
    at: string;
    wallet: string;
    payee: string;
    amount: string;
    decision: string;
    tx: string;
    window: string;
  }>;
  refusals: Array<Omit<SoakRefusal, "payeeShort" | "note">>;
  samples: Array<Omit<SoakSample, "payeeShort">>;
};
