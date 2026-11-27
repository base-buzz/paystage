/**
 * Pure helpers for `/lab/mesh` (#482).
 *
 * The page renders `soak-mesh.generated.json`, a projection the ops extractor builds from
 * `apps/console/public/mesh/latest.json`. Nothing here reads the host journal: the snapshot is the
 * only input, and every panel can be re-derived from its `rows` with `amountToMicro` and the
 * grouping functions in the checker.
 */
import type { SoakProjection } from "./soak-mesh-types";

export type {
  SoakCounts,
  SoakEdge,
  SoakHeatmapRow,
  SoakMesh,
  SoakMeshNode,
  SoakProjection,
  SoakRefusal,
  SoakSample,
  SoakTotals,
  SoakWindow,
} from "./soak-mesh-types";

/** Amounts are six-decimal strings in the journal; integer micro-units keep conservation exact. */
export function amountToMicro(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount);
  if (!match) throw new Error(`unparseable amount: ${JSON.stringify(amount)}`);
  return Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
}

export function formatEth(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const fraction = String(micro % 1_000_000).padStart(6, "0");
  return `${whole}.${fraction}`;
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPayment(amount: string): string {
  return `${amount} ETH`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utcParts(iso: string) {
  const date = new Date(iso);
  return {
    day: date.getUTCDate(),
    month: MONTHS[date.getUTCMonth()],
    year: date.getUTCFullYear(),
    hour: String(date.getUTCHours()).padStart(2, "0"),
    minute: String(date.getUTCMinutes()).padStart(2, "0"),
  };
}

/** Deterministic UTC formatting: there is no client render to disagree with the server. */
export function formatTimestamp(iso: string): string {
  const p = utcParts(iso);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} UTC`;
}

export function formatTime(iso: string): string {
  const p = utcParts(iso);
  return `${p.hour}:${p.minute} UTC`;
}

export function formatDay(isoDate: string): string {
  const p = utcParts(`${isoDate}T00:00:00Z`);
  return `${p.day} ${p.month}`;
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * Conservation, recomputed from the raw row shape used by the snapshot.
 *
 * The three sums are independent: adding every row, adding each payer's total, and adding each
 * payee's total. They must agree exactly, in integer micro-units.
 */
export function conservation(rows: Array<{ wallet: string; payee: string; amount: string }>): {
  totalMicro: number;
  payerMicro: number;
  payeeMicro: number;
  differenceMicro: number;
  payments: number;
  payers: number;
  payees: number;
} {
  const payer = new Map<string, number>();
  const payee = new Map<string, number>();
  let totalMicro = 0;
  for (const row of rows) {
    const micro = amountToMicro(row.amount);
    totalMicro += micro;
    payer.set(row.wallet, (payer.get(row.wallet) ?? 0) + micro);
    payee.set(row.payee, (payee.get(row.payee) ?? 0) + micro);
  }
  const payerMicro = [...payer.values()].reduce((sum, micro) => sum + micro, 0);
  const payeeMicro = [...payee.values()].reduce((sum, micro) => sum + micro, 0);
  return {
    totalMicro,
    payerMicro,
    payeeMicro,
    differenceMicro: payerMicro - payeeMicro,
    payments: rows.length,
    payers: payer.size,
    payees: payee.size,
  };
}

/** The generated projection is JSON, so it arrives untyped; validate the one shape the page needs. */
export function asSoakProjection(value: unknown): SoakProjection {
  const projection = value as SoakProjection;
  if (!projection || typeof projection !== "object") throw new Error("soak projection is not an object");
  if (!Array.isArray(projection.mesh?.edges)) throw new Error("soak projection has no mesh edges");
  if (!Array.isArray(projection.heatmap?.rows)) throw new Error("soak projection has no heatmap rows");
  if (!Array.isArray(projection.samples)) throw new Error("soak projection has no sample payments");
  return projection;
}

/** Width in the mesh SVG scales with the square root of count so the 10k-payment aggregate does not erase the rest. */
export function linkWidth(count: number, maxCount: number): number {
  return 0.45 + 4.2 * Math.sqrt(count / Math.max(1, maxCount));
}

/** Node radius by volume share, clamped so the 88-payer aggregate stays a label, not a blob. */
export function nodeRadius(micro: number, maxMicro: number): number {
  return 5 + 9 * Math.sqrt(micro / Math.max(1, maxMicro));
}
