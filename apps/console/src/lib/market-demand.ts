/**
 * Read-side model for the demand half of `/lab` (#320).
 *
 * The demand row is a daily on-chain measurement: how many USDC transfers reached the payees the catalogue lists,
 * against a chain-wide baseline measured in the same block window. Two things make the number readable, and both
 * live here as data rather than as JSX:
 *
 * 1. **The method travels with the ratio.** A transfer count without "batched/channel settlement is not visible"
 *    reads as a claim about the market. `DEMAND_METHOD` is rendered next to the coverage number, always.
 * 2. **A zero is not a measurement unless the positive control passed.** If `control_topic_filter` is false the
 *    address filter could not find the busiest recipient in its own window, so every payee figure in that row is
 *    an artefact of a broken query. The baseline is still printed, because that is what proves the RPC answered.
 *
 * Coverage is `distinct_payees_paid ÷ market_supply.payees` for the *same date*. The catalogue is the population
 * the ratio describes; `market_demand.payees_listed` is not used as the denominator even though it exists, because
 * the item names the catalogue and a missing catalogue row must render as "no denominator", never as a guess.
 *
 * Staleness is measured from the row's `created_at` (the write time) and falls back to `run_date` at 00:00 UTC when
 * the writer did not record one. A daily figure has to say which day it is or it is unreadable.
 */

/** Rendered beside the coverage number on every state. The item mandates this sentence. */
export const DEMAND_METHOD = "direct USDC transfers; batched or channel settlement is not visible";

/** A daily row older than this is stale and says so with its age. */
export const STALE_AFTER_HOURS = 36;

const HOUR_MS = 3_600_000;

/**
 * Row shapes as they come back from PostgREST. Numeric columns are typed as `number | string | null` because
 * PostgreSQL numerics can serialise as either, and an unknown shape must render as unavailable rather than NaN.
 */
export interface MarketDemandRow {
  run_date?: string | null;
  window_blocks?: number | string | null;
  chain_usdc_transfers?: number | string | null;
  payee_transfers?: number | string | null;
  distinct_payees_paid?: number | string | null;
  distinct_payers?: number | string | null;
  repeat_payers?: number | string | null;
  size_p50_usdc?: number | string | null;
  size_p90_usdc?: number | string | null;
  payees_listed?: number | string | null;
  sampled_payees?: number | string | null;
  method?: string | null;
  control_topic_filter?: boolean | null;
  control_address?: string | null;
  likely_test_payers?: number | string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface MarketSupplyRow {
  run_date?: string | null;
  payees?: number | string | null;
  /** Sorted payee strings written by the collector; absent/[] on rows that predate the column. */
  payee_set?: unknown;
  [key: string]: unknown;
}

export type ControlStatus = "passed" | "failed" | "not-run";

export interface DemandSnapshot {
  runDate: string;
  windowBlocks: number;
  payeeTransfers: number;
  payeeTransfersValueUsdc: number | null;
  chainUsdcTransfers: number;
  distinctPayeesPaid: number;
  distinctPayers: number;
  repeatPayers: number;
  sizeP50Usdc: number | null;
  sizeP90Usdc: number | null;
  sampledPayees: number;
  /** `market_supply.payees` for the row's own date; null when that catalogue row is missing/unreadable. */
  payeesListed: number | null;
  /** `distinctPayeesPaid / payeesListed`; null when there is no honest denominator. */
  coverage: number | null;
  coverageUnavailable: string | null;
  control: { status: ControlStatus; address: string | null };
  /** The collector's own wording, kept beside the mandated method line rather than replaced by it. */
  storedMethod: string | null;
  likelyTestPayers: number | null;
}

export interface StaleInfo {
  ageHours: number;
  writtenAt: string;
  basis: "created_at" | "run_date";
}

export type DemandView =
  | { kind: "unreadable"; reason: string }
  | { kind: "none" }
  | { kind: "ready"; snapshot: DemandSnapshot; stale: StaleInfo | null };

export type ReadResult<T> = { ok: true; rows: T[] } | { ok: false; reason: string };

export interface DemandSources {
  demand: ReadResult<MarketDemandRow>;
  supply: ReadResult<MarketSupplyRow>;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function required(value: unknown): number | null {
  return numeric(value);
}

/**
 * Newest row by date, not by array order.
 *
 * `run_date` is the primary key, so the query already returns one row; this makes the selection explicit so the
 * panel cannot silently render yesterday's row if the read order changes or a second row is passed in a test.
 */
export function selectDemandRow(rows: MarketDemandRow[]): MarketDemandRow | null {
  const dated = rows.filter((row) => typeof row.run_date === "string" && row.run_date.trim() !== "");
  if (dated.length === 0) return null;
  return [...dated].sort((a, b) => {
    const byDate = String(b.run_date).localeCompare(String(a.run_date));
    if (byDate !== 0) return byDate;
    const aAt = typeof a.created_at === "string" ? Date.parse(a.created_at) : 0;
    const bAt = typeof b.created_at === "string" ? Date.parse(b.created_at) : 0;
    return (Number.isFinite(bAt) ? bAt : 0) - (Number.isFinite(aAt) ? aAt : 0);
  })[0]!;
}

/** The catalogue row for a given date — the coverage denominator, matched exactly rather than by "latest". */
export function selectSupplyForDate(rows: MarketSupplyRow[], runDate: string): MarketSupplyRow | null {
  return rows.find((row) => row.run_date === runDate) ?? null;
}

function controlOf(row: MarketDemandRow): { status: ControlStatus; address: string | null } {
  const address = typeof row.control_address === "string" && row.control_address.trim() !== "" ? row.control_address : null;
  if (row.control_topic_filter === true) return { status: "passed", address };
  if (row.control_topic_filter === false) return { status: "failed", address };
  // Absent is not passed. A row without a recorded control cannot licence a zero.
  return { status: "not-run", address };
}

function stalenessOf(row: MarketDemandRow, runDate: string, now: number): StaleInfo | null {
  const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
  const runDateAt = Date.parse(`${runDate}T00:00:00Z`);
  const basis: "created_at" | "run_date" = Number.isFinite(createdAt) ? "created_at" : "run_date";
  const written = Number.isFinite(createdAt) ? createdAt : runDateAt;
  if (!Number.isFinite(written)) return null;
  const ageHours = Number((Math.max(0, now - written) / HOUR_MS).toFixed(1));
  if (ageHours <= STALE_AFTER_HOURS) return null;
  return { ageHours, writtenAt: new Date(written).toISOString(), basis };
}

/**
 * Build the panel's view from one demand row and the catalogue row for its date.
 *
 * Every branch that cannot produce a figure says why. None of them falls back to zero.
 */
export function buildDemandView(sources: DemandSources, now: number): DemandView {
  const { demand, supply } = sources;
  if (!demand.ok) return { kind: "unreadable", reason: demand.reason };

  const row = selectDemandRow(demand.rows);
  if (row === null) return { kind: "none" };

  const runDate = String(row.run_date);
  const windowBlocks = required(row.window_blocks);
  const chainUsdcTransfers = required(row.chain_usdc_transfers);
  const payeeTransfers = required(row.payee_transfers);
  const distinctPayeesPaid = required(row.distinct_payees_paid);
  const distinctPayers = required(row.distinct_payers);
  const repeatPayers = required(row.repeat_payers);
  const sampledPayees = required(row.sampled_payees);
  const runDateAt = Date.parse(`${runDate}T00:00:00Z`);

  if (
    !Number.isFinite(runDateAt) ||
    windowBlocks === null ||
    chainUsdcTransfers === null ||
    payeeTransfers === null ||
    distinctPayeesPaid === null ||
    distinctPayers === null ||
    repeatPayers === null ||
    sampledPayees === null
  ) {
    return {
      kind: "unreadable",
      reason: `the newest demand row (${runDate}) is missing required fields, so its figures cannot be read as measurements`,
    };
  }

  let payeesListed: number | null = null;
  let coverage: number | null = null;
  let coverageUnavailable: string | null = null;

  if (!supply.ok) {
    coverageUnavailable = `the catalogue reading for ${runDate} could not be read (${supply.reason}), so coverage has no denominator`;
  } else {
    const supplyRow = selectSupplyForDate(supply.rows, runDate);
    if (supplyRow === null) {
      coverageUnavailable = `no catalogue row exists for ${runDate}, so coverage has no denominator`;
    } else {
      const listed = required(supplyRow.payees);
      if (listed === null || listed <= 0) {
        coverageUnavailable = `the catalogue row for ${runDate} lists no payees, so coverage has no denominator`;
      } else {
        payeesListed = listed;
        coverage = distinctPayeesPaid / listed;
      }
    }
  }

  const snapshot: DemandSnapshot = {
    runDate,
    windowBlocks,
    payeeTransfers,
    payeeTransfersValueUsdc: numeric(row.payee_transfers_value_usdc),
    chainUsdcTransfers,
    distinctPayeesPaid,
    distinctPayers,
    repeatPayers,
    sizeP50Usdc: numeric(row.size_p50_usdc),
    sizeP90Usdc: numeric(row.size_p90_usdc),
    sampledPayees,
    payeesListed,
    coverage,
    coverageUnavailable,
    control: controlOf(row),
    storedMethod:
      typeof row.method === "string" && row.method.trim() !== "" ? row.method.trim() : null,
    likelyTestPayers: numeric(row.likely_test_payers),
  };

  return { kind: "ready", snapshot, stale: stalenessOf(row, runDate, now) };
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** A missing size renders as an em dash, never as 0 — "unknown" is not "free". */
export function formatUsdc(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`;
}

/** Coverage as a percentage with enough precision to keep a sub-1% number from rounding to zero. */
export function formatCoverage(coverage: number | null): string {
  if (coverage === null) return "—";
  return `${(coverage * 100).toFixed(2)}%`;
}

/** The sentence under the ratio: paid over listed, plus the sample the numerator actually covers. */
export function coverageDetail(snapshot: DemandSnapshot): string {
  if (snapshot.coverage === null || snapshot.payeesListed === null) {
    return snapshot.coverageUnavailable ?? "coverage unavailable";
  }
  return `${formatCount(snapshot.distinctPayeesPaid)} of ${formatCount(snapshot.payeesListed)} listed payees paid; we watched the ${formatCount(snapshot.sampledPayees)} busiest Base payees`;
}

/**
 * The control line. Returned rather than inlined so the zero-vs-broken distinction is asserted in tests.
 *
 * A failed control still prints the baseline: it is the proof that the RPC answered and that the row is about the
 * same window, which is what lets a reader see the zero as broken rather than as demand.
 */
export function controlNotice(control: DemandSnapshot["control"], chainUsdcTransfers: number): string {
  const baseline = formatCount(chainUsdcTransfers);
  if (control.status === "failed") {
    return `The address filter did not match its own control, so a zero that day means nothing — the query is broken, not the market. Chain-wide baseline in the same window: ${baseline} USDC transfers.`;
  }
  if (control.status === "not-run") {
    return `No positive control was recorded for this row, so a zero cannot be told apart from a broken address filter. Chain-wide baseline in the same window: ${baseline} USDC transfers.`;
  }
  return `The positive control passed — the address filter found this window's busiest recipient, so a zero here would be a real zero. Chain-wide baseline in the same window: ${baseline} USDC transfers.`;
}

/** Staleness with the age and the timestamp it was measured from — a daily number without a date is unreadable. */
export function staleNotice(stale: StaleInfo): string {
  const stamp = `${stale.writtenAt.slice(0, 16).replace("T", " ")} UTC`;
  const basis = stale.basis === "created_at" ? "written" : "dated";
  return `Stale — the newest demand row is ${stale.ageHours.toFixed(1)} hours old (${basis} ${stamp}). These are that day's figures, not today's.`;
}

/** Kept for the panel's punctuation; also the only place the collector wording is quoted. */
export function storedMethodLabel(storedMethod: string | null): string | null {
  if (storedMethod === null || storedMethod === DEMAND_METHOD) return null;
  return `Collector's stored method: “${storedMethod}”.`;
}
