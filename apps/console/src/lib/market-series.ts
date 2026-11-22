/**
 * Read-side model for the daily market **series** (#322).
 *
 * The `/lab` market panels used to read one row from each table and show it as if it were a trend. One point is not a
 * trend, and a delta against nothing is not a movement, so this module makes the calendar explicit:
 *
 * 1. **Every calendar day in the range has a point.** A day with no row is a `missing: true` point with a `null`
 *    value — never a zero, and never omitted, because an omitted day is how a caller ends up joining 21 November to
 *    19 November and calling the difference "today".
 * 2. **A delta is only computed between consecutive calendar days.** `buildSeries` returns a `SeriesDelta` whose
 *    `value` is `null` and whose `reason` says why whenever the previous day has no row, the pair is not consecutive,
 *    or either side is unreadable. The UI renders "no comparable day"; it cannot accidentally subtract across a gap.
 * 3. **Readiness is seven consecutive days.** `consecutiveDays` is the trailing run of usable values and `ready` is
 *    that run reaching `SERIES_WINDOW_DAYS`. Before then the page shows the count and today's value — not a line.
 *
 * The series is *derived*, never stored: `market_supply` and `market_demand` are still the only sources of truth.
 * Coverage keeps the rule from #320 — `distinct_payees_paid ÷ market_supply.payees` for the same date, not the demand
 * row's own `payees_listed`, because a missing catalogue row must render as "no denominator".
 *
 * There is no interpolation anywhere in this file. `seriesSegments` breaks a line into independent segments at every
 * gap (and at every unreadable value), so a chart can draw the days that exist without inventing the days that do not.
 *
 * The module is pure: no `Date.now()`, no network, no React. Tests in `tests/market-series.test.ts` own the calendar.
 */

import type { MarketDemandRow, MarketSupplyRow } from "@/lib/market-demand";

/** The number of consecutive days a line needs before it is drawn. */
export const SERIES_WINDOW_DAYS = 7;

/** The exact cell text a delta uses when it refuses to compare across a gap. */
export const NO_COMPARABLE_DAY = "no comparable day";

const DAY_MS = 86_400_000;

/** Any row with the two fields the series needs to place it on the calendar. */
export interface DatedRow {
  run_date?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface SeriesPoint<T extends DatedRow> {
  /** Normalised `YYYY-MM-DD`; the calendar key. */
  runDate: string;
  /** The row for this day, or null when the day has no row. */
  row: T | null;
  /** The metric's value for this day, or null when it cannot be read. */
  value: number | null;
  /** True when this calendar day has no row at all. Never conflated with a zero value. */
  missing: boolean;
}

export interface SeriesDelta {
  /** Absolute change against the previous calendar day; null when not comparable. */
  value: number | null;
  /** The value on the previous calendar day, when comparable. */
  previous: number | null;
  comparable: boolean;
  /** Why there is no delta, phrased for a reader. Null when comparable. */
  reason: string | null;
  /** Date of the latest measured day. */
  to: string | null;
  /** Date compared against; null when there is no measured day. */
  from: string | null;
}

export interface Series<T extends DatedRow> {
  /** Ascending calendar days from the first row to the last, gaps included. */
  points: SeriesPoint<T>[];
  /** The same points keyed by `run_date`, so a caller cannot join by guessing an adjacent date string. */
  byDate: Record<string, SeriesPoint<T>>;
  /** Trailing run of consecutive days with a usable value. */
  consecutiveDays: number;
  /** True only at `SERIES_WINDOW_DAYS` consecutive days or more. */
  ready: boolean;
  /** The most recent day with a usable value, not merely the last row. */
  latest: SeriesPoint<T> | null;
  /** Day-over-day change, or an explicit refusal. */
  delta: SeriesDelta;
}

export interface MarketDay {
  runDate: string;
  /** True when neither table has a row for this day. */
  missing: boolean;
  supplyMissing: boolean;
  demandMissing: boolean;
  supply: MarketSupplyRow | null;
  demand: MarketDemandRow | null;
  /** `market_supply.accepts`. */
  accepts: number | null;
  /** `market_demand.payee_transfers`. */
  payeeTransfers: number | null;
  /** `distinct_payees_paid ÷ market_supply.payees` for this same date. */
  coverage: number | null;
  /** Top-10 accepts ÷ total accepts for this same date. */
  concentration: number | null;
}

export type MarketMetric = "accepts" | "payeeTransfers" | "coverage" | "concentration";

export interface MarketMetrics {
  accepts: Series<MarketSupplyRow>;
  payeeTransfers: Series<MarketDemandRow>;
  coverage: Series<MarketDemandRow>;
  concentration: Series<MarketSupplyRow>;
}

export interface MarketSeries {
  /** Union calendar days across both tables, gaps included. */
  points: MarketDay[];
  byDate: Record<string, MarketDay>;
  metrics: MarketMetrics;
  /** The most recent day where at least one table has a row. */
  latestDay: MarketDay | null;
  /**
   * Trailing consecutive days the **coverage** metric is readable, because coverage is the headline the chart draws.
   * Each metric also carries its own `consecutiveDays` / `ready` for its own delta and readiness state.
   */
  consecutiveDays: number;
  ready: boolean;
  /** Non-missing days in the range, for a "n days collected" caption. */
  daysCollected: number;
}

export interface MarketSeriesInput {
  supply: MarketSupplyRow[];
  demand: MarketDemandRow[];
}

/**
 * A stable stringify for duplicate-date tie-breaking.
 *
 * Rows arrive from PostgREST with whatever key order the JSON decoder produced; comparing `JSON.stringify` directly
 * would make "which duplicate wins" depend on key order. Sorting keys makes the choice reproducible from content.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Normalise a `run_date` to `YYYY-MM-DD` in UTC, or null when it is not a real date.
 *
 * The column is a Postgres `date`, but the page types it as `string | null` and a malformed value must be dropped
 * rather than shifted onto an adjacent day by the local timezone.
 */
export function normalizeRunDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === iso ? iso : null;
}

function addDays(runDate: string, delta: number): string {
  return new Date(Date.parse(`${runDate}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

function calendarBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) out.push(date);
  return out;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * One row per date, newest **write** wins.
 *
 * `run_date` is the primary key, so a duplicate in an input array is either a test fixture or a read that overlapped
 * a re-run. Choosing by `created_at` (and, on a tie, by content) makes the result independent of array order.
 */
function rowsByDate<T extends DatedRow>(rows: T[]): Map<string, T> {
  const best = new Map<string, { row: T; writtenAt: number; canon: string }>();
  for (const row of rows) {
    const runDate = normalizeRunDate(row.run_date);
    if (runDate === null) continue;
    const parsed = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
    const writtenAt = Number.isFinite(parsed) ? parsed : 0;
    const canon = stableStringify(row);
    const current = best.get(runDate);
    if (
      current === undefined ||
      writtenAt > current.writtenAt ||
      (writtenAt === current.writtenAt && canon > current.canon)
    ) {
      best.set(runDate, { row, writtenAt, canon });
    }
  }
  return new Map([...best.entries()].map(([runDate, entry]) => [runDate, entry.row]));
}

function emptyDelta(reason: string): SeriesDelta {
  return { value: null, previous: null, comparable: false, reason, to: null, from: null };
}

/**
 * Build one metric's calendar series from a set of dated rows.
 *
 * This is the function every figure on the page goes through. It fills the calendar between the first and last row,
 * marks days with no row as `missing`, refuses a delta unless the previous calendar day has a usable value, and counts
 * the trailing consecutive run for readiness. It never substitutes a zero.
 */
export function buildSeries<T extends DatedRow>(
  rows: T[],
  valueOf: (row: T) => number | null,
  range?: { first: string; last: string },
): Series<T> {
  const byDateRows = rowsByDate(rows);
  const dates = [...byDateRows.keys()].sort();
  if (dates.length === 0 && range === undefined) {
    return {
      points: [],
      byDate: {},
      consecutiveDays: 0,
      ready: false,
      latest: null,
      delta: emptyDelta("no measured day yet"),
    };
  }

  const first = range?.first ?? dates[0]!;
  const last = range?.last ?? dates[dates.length - 1]!;
  const points: SeriesPoint<T>[] = calendarBetween(first, last).map((runDate) => {
    const row = byDateRows.get(runDate) ?? null;
    return {
      runDate,
      row,
      value: row === null ? null : valueOf(row),
      missing: row === null,
    };
  });
  const byDate = Object.fromEntries(points.map((point) => [point.runDate, point]));

  // Trailing run: a null value breaks the count, whether the day is missing entirely or only its metric is unreadable.
  let consecutiveDays = 0;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i]!.value === null) break;
    consecutiveDays += 1;
  }

  const latest = [...points].reverse().find((point) => point.value !== null) ?? null;
  let delta: SeriesDelta;
  if (latest === null) {
    delta = emptyDelta("no measured day yet");
  } else {
    const previousDate = addDays(latest.runDate, -1);
    const previousPoint = byDate[previousDate];
    if (previousPoint === undefined) {
      // Cannot happen while the range starts at the earliest row and ends at the latest, but the branch exists so a
      // future caller passing a sparse `points` list still cannot join across an absent day.
      delta = { value: null, previous: null, comparable: false, reason: `no point for ${previousDate}`, to: latest.runDate, from: null };
    } else if (previousPoint.missing) {
      delta = {
        value: null,
        previous: null,
        comparable: false,
        reason: `no row for ${previousDate}, the previous calendar day`,
        to: latest.runDate,
        from: previousDate,
      };
    } else if (previousPoint.value === null) {
      delta = {
        value: null,
        previous: null,
        comparable: false,
        reason: `${previousDate} has no readable value`,
        to: latest.runDate,
        from: previousDate,
      };
    } else {
      delta = {
        value: latest.value! - previousPoint.value,
        previous: previousPoint.value,
        comparable: true,
        reason: null,
        to: latest.runDate,
        from: previousDate,
      };
    }
  }

  return {
    points,
    byDate,
    consecutiveDays,
    ready: consecutiveDays >= SERIES_WINDOW_DAYS,
    latest,
    delta,
  };
}

/** One entry of `market_supply.top_payees`, normalised and numerically parsed. */
export interface TopPayee {
  payee: string;
  accepts: number;
  resources: number;
  hosts: number;
}

/**
 * The stored top-10 table, cleaned.
 *
 * `top_payees` is written by the collector as `[{payee, accepts, resources, hosts}]`, already sliced to ten. The
 * sort-and-slice here makes the "top-10" claim true even if a future writer stores more: the concentration number
 * must describe the same ten rows the table renders.
 */
export function topPayees(row: MarketSupplyRow | null | undefined): TopPayee[] {
  const raw = row?.top_payees;
  if (!Array.isArray(raw)) return [];
  const parsed: TopPayee[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const payee = typeof record.payee === "string" ? record.payee.trim() : "";
    const accepts = numeric(record.accepts);
    if (payee === "" || accepts === null || accepts < 0) continue;
    parsed.push({
      payee,
      accepts,
      resources: numeric(record.resources) ?? 0,
      hosts: numeric(record.hosts) ?? 0,
    });
  }
  return parsed.sort((a, b) => b.accepts - a.accepts || a.payee.localeCompare(b.payee)).slice(0, 10);
}

/**
 * Concentration: top-10 accepts ÷ total accepts.
 *
 * The denominator is the row's own `accepts`, which is the total the catalogue counted that day. Null when there is
 * no positive denominator — a share of zero is not a measurement.
 */
export function concentrationOf(row: MarketSupplyRow | null | undefined): number | null {
  if (row === null || row === undefined) return null;
  const total = numeric(row.accepts);
  if (total === null || total <= 0) return null;
  const top = topPayees(row);
  // A row that counted accepts but stored no readable top_payees has an unknown share, not a zero share.
  if (top.length === 0) return null;
  const topAccepts = top.reduce((sum, payee) => sum + payee.accepts, 0);
  return topAccepts / total;
}

/** The numerator behind `concentrationOf`, so the sentence beside the share can cite it. */
export function topTenAccepts(row: MarketSupplyRow | null | undefined): number | null {
  if (row === null || row === undefined) return null;
  if (numeric(row.accepts) === null) return null;
  const top = topPayees(row);
  if (top.length === 0) return null;
  return top.reduce((sum, payee) => sum + payee.accepts, 0);
}

/** How many addresses of each side the panel prints before it says "+N more". */
export const PAYEE_ADDRESSES_SHOWN = 5;

/** A set difference over two consecutive catalogue days, or an explicit refusal. */
export interface PayeeDelta {
  /** True only when both days have a stored, readable payee set and are consecutive calendar days. */
  comparable: boolean;
  /** Date compared against; null when there is no measured day. */
  from: string | null;
  /** Date the delta describes. */
  to: string | null;
  /** Payees in `to` that are not in `from`, sorted. Empty when not comparable. */
  newPayees: string[];
  /** Payees in `from` that are not in `to`, sorted. Empty when not comparable. */
  gonePayees: string[];
  /** Why there is no set difference, phrased for a reader. Null when comparable. */
  reason: string | null;
}

/**
 * The payee strings a supply row stored.
 *
 * `payee_set` is written by the collector as a sorted array. The order is not trusted here and non-string entries are
 * dropped, so one malformed element cannot make the whole set unreadable — but the result is sorted and de-duplicated
 * so equality never depends on the writer. Returns null when the field is absent or not an array.
 */
export function payeeSetOf(row: MarketSupplyRow | null | undefined): string[] | null {
  const raw = row?.payee_set;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const payee = entry.trim();
    if (payee !== "") seen.add(payee);
  }
  return [...seen].sort();
}

/**
 * A stored set that can be read as a measurement.
 *
 * The migration added `payee_set` with `default '[]'`, so a row written before the column existed has an empty array
 * while its `payees` count is positive. That is missing data, not an empty market: it must produce no delta rather than
 * "every payee left". An empty set is only readable when the row also counted zero payees.
 */
function readablePayeeSet(row: MarketSupplyRow | null | undefined): string[] | null {
  const set = payeeSetOf(row);
  if (set === null) return null;
  const counted = numeric(row?.payees);
  // An empty array beside a positive count is the pre-migration default, not a market that emptied.
  if (set.length === 0 && (counted === null || counted > 0)) return null;
  // If the row says how many payees it counted, the stored set must agree. A shorter set would silently make the
  // missing members look "gone" (or skip them as "new"), so it is unreadable rather than partially comparable.
  if (counted !== null && counted !== set.length) return null;
  return set;
}

function emptyPayeeDelta(reason: string): PayeeDelta {
  return { comparable: false, from: null, to: null, newPayees: [], gonePayees: [], reason };
}

/**
 * New and gone payees against the previous **consecutive** calendar day.
 *
 * This is the one delta that cannot be derived from `top_payees`: a set difference needs the whole set, so the
 * collector stores it. The rule is the same as every other metric in this module — the previous day must have a row,
 * and the pair must be consecutive. A gap returns `comparable: false` with a reason; it never subtracts 19 November
 * from 21 November and calls the difference "today". Exact strings only: an address that changed case counts as both
 * new and gone, which is why the panel says the match is on the catalogue's strings.
 */
export function buildPayeeDelta(rows: MarketSupplyRow[], latestRow?: MarketSupplyRow | null): PayeeDelta {
  const byDate = rowsByDate(rows);
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0 && latestRow == null) return emptyPayeeDelta("no measured day yet");

  const to = normalizeRunDate(latestRow?.run_date) ?? dates[dates.length - 1] ?? null;
  if (to === null) return emptyPayeeDelta("no measured day yet");
  const latest = latestRow ?? byDate.get(to) ?? null;
  const current = readablePayeeSet(latest);
  if (current === null) {
    return {
      comparable: false,
      from: addDays(to, -1),
      to,
      newPayees: [],
      gonePayees: [],
      reason: `${to} has no readable payee set (the row predates the stored set, or its payee_set is malformed)`,
    };
  }

  const from = addDays(to, -1);
  const previousRow = byDate.get(from) ?? null;
  if (previousRow === null) {
    return {
      comparable: false,
      from,
      to,
      newPayees: [],
      gonePayees: [],
      reason: `no row for ${from}, the previous calendar day`,
    };
  }
  const previous = readablePayeeSet(previousRow);
  if (previous === null) {
    return {
      comparable: false,
      from,
      to,
      newPayees: [],
      gonePayees: [],
      reason: `${from} has no readable payee set (the row predates the stored set, or its payee_set is malformed)`,
    };
  }

  const currentSet = new Set(current);
  const previousSet = new Set(previous);
  return {
    comparable: true,
    from,
    to,
    newPayees: current.filter((payee) => !previousSet.has(payee)),
    gonePayees: previous.filter((payee) => !currentSet.has(payee)),
    reason: null,
  };
}

/**
 * The sentence the panel prints: "N new payees, M gone since <date>".
 *
 * Counts are the size of the set difference, not a stored count — a stored count cannot name the addresses a reader
 * might want to check. Not comparable renders the same cell text as every other delta.
 */
export function payeeDeltaSummary(delta: PayeeDelta): string {
  if (!delta.comparable) return NO_COMPARABLE_DAY;
  const added = delta.newPayees.length;
  const removed = delta.gonePayees.length;
  return `${added.toLocaleString("en-US")} new payee${added === 1 ? "" : "s"}, ${removed.toLocaleString(
    "en-US",
  )} gone since ${delta.from}`;
}

/** The first few addresses of one side, plus how many the panel is not printing. */
export function payeeDeltaAddresses(
  addresses: string[],
  limit: number = PAYEE_ADDRESSES_SHOWN,
): { shown: string[]; more: number } {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : PAYEE_ADDRESSES_SHOWN;
  const shown = addresses.slice(0, cap);
  return { shown, more: Math.max(0, addresses.length - shown.length) };
}

/**
 * Coverage for one demand row against the catalogue row for the **same date**.
 *
 * Deliberately not `market_demand.payees_listed`: #320 established that the catalogue is the population the ratio
 * describes, and a missing catalogue row means "no denominator", not "borrow yesterday's".
 */
export function coverageOf(
  demand: MarketDemandRow | null | undefined,
  supply: MarketSupplyRow | null | undefined,
): number | null {
  if (demand === null || demand === undefined || supply === null || supply === undefined) return null;
  // The ratio is only meaningful for one day: a demand row measured against another day's catalogue is two days in
  // one number, so a mismatched pair has no coverage rather than a plausible-looking one.
  const demandDate = normalizeRunDate(demand.run_date);
  const supplyDate = normalizeRunDate(supply.run_date);
  if (demandDate === null || supplyDate === null || demandDate !== supplyDate) return null;
  const paid = numeric(demand.distinct_payees_paid);
  const listed = numeric(supply.payees);
  if (paid === null || listed === null || listed <= 0) return null;
  return paid / listed;
}

/**
 * Build the whole market series: four metric series plus the combined calendar.
 *
 * The combined `points` exist so a page can say "no row that day" about the market as a whole; the metric series are
 * what every delta and the chart use, because a day can have supply and no demand (or the reverse) and each metric
 * must break on its own missing input rather than borrowing the other half's row.
 */
export function buildMarketSeries(input: MarketSeriesInput): MarketSeries {
  const supplyByDate = rowsByDate(input.supply);
  const demandByDate = rowsByDate(input.demand);

  const dates = [...new Set([...supplyByDate.keys(), ...demandByDate.keys()])].sort();
  const points: MarketDay[] =
    dates.length === 0
      ? []
      : calendarBetween(dates[0]!, dates[dates.length - 1]!).map((runDate) => {
          const supply = supplyByDate.get(runDate) ?? null;
          const demand = demandByDate.get(runDate) ?? null;
          return {
            runDate,
            missing: supply === null && demand === null,
            supplyMissing: supply === null,
            demandMissing: demand === null,
            supply,
            demand,
            accepts: supply === null ? null : numeric(supply.accepts),
            payeeTransfers: demand === null ? null : numeric(demand.payee_transfers),
            coverage: coverageOf(demand, supply),
            concentration: concentrationOf(supply),
          };
        });

  const range = dates.length === 0 ? undefined : { first: dates[0]!, last: dates[dates.length - 1]! };
  const metrics: MarketMetrics = {
    accepts: buildSeries(input.supply, (row) => numeric(row.accepts), range),
    payeeTransfers: buildSeries(input.demand, (row) => numeric(row.payee_transfers), range),
    coverage: buildSeries(
      input.demand,
      (row) => {
        const runDate = normalizeRunDate(row.run_date);
        return runDate === null ? null : coverageOf(row, supplyByDate.get(runDate) ?? null);
      },
      range,
    ),
    concentration: buildSeries(input.supply, (row) => concentrationOf(row), range),
  };

  const latestDay = [...points].reverse().find((point) => !point.missing) ?? null;
  return {
    points,
    byDate: Object.fromEntries(points.map((point) => [point.runDate, point])),
    metrics,
    latestDay,
    consecutiveDays: metrics.coverage.consecutiveDays,
    ready: metrics.coverage.ready,
    daysCollected: points.filter((point) => !point.missing).length,
  };
}

/**
 * Split a series into contiguous runs of usable values.
 *
 * This is the only thing a chart is allowed to join. A null value — a missing day or an unreadable metric — ends the
 * current segment and starts a new one, so the renderer draws two lines rather than interpolating across a hole.
 */
export function seriesSegments<T extends DatedRow>(
  points: SeriesPoint<T>[],
): Array<Array<{ index: number; point: SeriesPoint<T> }>> {
  const segments: Array<Array<{ index: number; point: SeriesPoint<T> }>> = [];
  let current: Array<{ index: number; point: SeriesPoint<T> }> = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ index, point });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

/** A count or a percentage, depending on the metric. A null value is an em dash, never a zero. */
export function formatMetricValue(metric: MarketMetric, value: number | null): string {
  if (value === null) return "—";
  if (metric === "coverage" || metric === "concentration") {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toLocaleString("en-US");
}

/** Format a day-over-day change: counts as signed integers, ratios as signed percentage points. */
export function formatMetricDelta(metric: MarketMetric, value: number | null): string {
  if (value === null) return NO_COMPARABLE_DAY;
  if (metric === "coverage" || metric === "concentration") {
    const points = value * 100;
    // Only an exactly zero change is called flat; a small move keeps its direction rather than being rounded away.
    if (points === 0) return "= flat";
    return `${points > 0 ? "↑ +" : "↓ "}${points.toFixed(2)}pp`;
  }
  if (value === 0) return "= flat";
  return `${value > 0 ? "↑ +" : "↓ "}${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * The sentence under the concentration line.
 *
 * It names both numbers and what the denominator is, so a reader cannot mistake the share for "share of the market"
 * in a sense the catalogue did not measure.
 */
export function concentrationNotice(row: MarketSupplyRow | null): string {
  const share = concentrationOf(row);
  const accepts = numeric(row?.accepts);
  const top = topTenAccepts(row);
  if (share === null || accepts === null || top === null) {
    return "Top-10 concentration unavailable — this catalogue row has no readable accepts total.";
  }
  return `The top 10 payees account for ${formatMetricValue("concentration", share)} of the ${accepts.toLocaleString(
    "en-US",
  )} accepts counted in the catalogue on ${String(row?.run_date ?? "that date")} (${top.toLocaleString("en-US")} of ${accepts.toLocaleString("en-US")}).`;
}
