/**
 * The period accrual (#474): one row per vendor × cost centre × month, in integer minor units,
 * with a deterministic hash of the decisions behind it.
 *
 * Why this lives in `apps/console` and not only in an ops script: the CSV download, the JSON
 * endpoint and the `/lab/accrual` page must all emit the *same* rows with the *same* field names.
 * Two implementations would eventually disagree, and a script that disagrees with a spreadsheet is
 * worse than no export. The ops CLI (`/work/ops/bin/accrual-export.mjs`) imports this module too,
 * so there is one aggregation and three ways to reach it.
 *
 * ## The two columns that do not exist
 *
 * `public.events` has no `vendor` and no `cost_centre`. This file does not pretend otherwise.
 *
 * **vendor** is derived from `pay_to`, the address a payment was made to. The address is trimmed
 * and lower-cased so `0xAB…` and `0xab…` are one vendor. When `pay_to` is empty the row's vendor
 * is the literal `vendor_not_recorded`: it is a bucket, not a vendor, and it is where most refusals
 * land because a refusal never reaches a payee and records no `pay_to`.
 *
 * **cost_centre** comes from exactly one place: `apps/console/src/lib/accrual-cost-centres.json`,
 * a small file finance edits. A vendor missing from it is `unassigned`. This is deliberate. The
 * alternative — joining through `mandates.tenant_id` — is not available: `events` carries no
 * mandate serial or tenant column, and `mandates` carries no payee column. A join on `payer` or
 * `agent` would be a guess dressed as an allocation. `unassigned` means "finance has not coded this
 * vendor yet", never "no cost centre exists".
 *
 * ## Money
 *
 * `amount_usdc` is a whole-USDC decimal string in the database (`numeric(18,6)`). It is parsed as a
 * decimal string into **micro-USDC** with `BigInt`, and every sum is `BigInt`. A float never touches
 * the value, so rounding is impossible by construction: `0.002` is exactly `2000n`, and 41 of them
 * are exactly `82000n`. Seven decimal places, a negative amount, or an exponent (`1e-7`) is refused
 * rather than rounded.
 *
 * ## Which decisions are money
 *
 * `settled` on Base mainnet (`eip155:8453`) is a payment. `settled` on any other network is counted
 * in the summary but **excluded from money totals**: testnet USDC is not spend, and adding it to
 * mainnet USDC would make the accrual wrong in the direction that flatters it. `do_not_pay` is a
 * refusal: it contributes to `refusals`, never to `total_minor`, and it is counted on every network
 * because the control working is the same fact everywhere. Other decisions (`402`, `pay`, `review`,
 * failures) are not part of an accrual.
 *
 * `settled` with no amount is counted and contributes 0: the export does not invent a value for it.
 * That is visible in `summary.settledUnpriced` and in the page copy.
 *
 * ## evidence_hash
 *
 * SHA-256 of the sorted decision ids behind the row, UTF-8, each id followed by a newline:
 *
 *     sha256( [...ids].sort().join("\n") + "\n" )
 *
 * The ids are the `events.id` UUIDs of the settled and refused decisions in the row, so a finance
 * person can re-run the query and the recipe and get the same hex. Duplicate ids are refused, not
 * de-duplicated, because a duplicate would mean the same decision was counted twice.
 */

/** The exact column order for CSV. JSON uses the same names. */
export const ACCRUAL_COLUMNS = [
  "period",
  "vendor",
  "cost_centre",
  "currency",
  "total_minor",
  "count",
  "refusals",
  "first_ts",
  "last_ts",
  "evidence_hash",
] as const;

export type AccrualColumn = (typeof ACCRUAL_COLUMNS)[number];

export type AccrualRow = {
  period: string;
  vendor: string;
  cost_centre: string;
  currency: string;
  total_minor: number;
  count: number;
  refusals: number;
  first_ts: string;
  last_ts: string;
  evidence_hash: string;
};

/** The only network whose settled payments are money. Base mainnet. */
export const PRODUCTION_NETWORK = "eip155:8453";
/** Six decimal places, because `amount_usdc` is `numeric(18,6)`. */
export const MINOR_UNIT_SCALE = 6;
const MINOR_UNITS_PER_USDC = 1_000_000n;
export const ACCRUAL_CURRENCY = "USDC";
/** `pay_to` is empty. A bucket, never a vendor. */
export const VENDOR_NOT_RECORDED = "vendor_not_recorded";
/** Finance has not assigned a cost centre to this vendor. Never a guessed accounting code. */
export const DEFAULT_COST_CENTRE = "unassigned";
/** The page's default range: the current UTC calendar month. */
export const DEFAULT_ACCRUAL_DAYS = 31;
export const MAX_ACCRUAL_DAYS = 366;
export const MAX_ACCRUAL_ROWS = 100_000;

/** One decision read from `public.events`, with `amount_usdc` cast to text by PostgREST. */
export type AccrualDecision = {
  id: string;
  ts: string;
  decision: string;
  amount_usdc?: string | number | null;
  pay_to?: string | null;
  network?: string | null;
};

/** The JSON shape finance edits. Keys are lower-cased vendor addresses. */
export type CostCentreMap = {
  default: string;
  vendors: Record<string, string>;
};

export type AccrualSummary = {
  /** Decisions read, after the range filter. */
  decisions: number;
  /** `settled` on Base mainnet: the population the money totals cover. */
  settledProduction: number;
  /** `settled` on any other network: counted, never added to money. */
  settledOtherNetwork: number;
  /** `settled` on Base mainnet with no `amount_usdc`; counted, contributes 0. */
  settledUnpriced: number;
  /** `do_not_pay` on every network. A count, never a sum. */
  refusals: number;
  /** Settled payments resolved to `mandates.tenant_id`. There is no join key, so this is 0. */
  settledResolvedToTenant: number;
  /** Settled payments with no tenant. This is the whole population today. */
  settledWithoutTenant: number;
};

export type AccrualBuild = {
  rows: AccrualRow[];
  summary: AccrualSummary;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the finance-edited mapping. Bad input throws rather than falling back to a default,
 * because a typo in a cost-centre code must not silently turn into `unassigned` across a month.
 *
 * Only address keys are accepted. `vendor_not_recorded` cannot be mapped: it is the absence of a
 * vendor, and assigning it a cost centre would be inventing the allocation the export exists to
 * avoid.
 */
export function normalizeCostCentreMap(raw: unknown): CostCentreMap {
  if (!isRecord(raw)) throw new Error("accrual-cost-centres.json must be a JSON object");
  const fallback = typeof raw.default === "string" ? raw.default.trim() : "";
  if (fallback === "") throw new Error("accrual-cost-centres.json needs a non-empty `default`");

  const vendorRaw = raw.vendors;
  if (vendorRaw !== undefined && !isRecord(vendorRaw)) {
    throw new Error("`vendors` must be an object of address -> cost centre");
  }

  const vendors: Record<string, string> = {};
  for (const [key, value] of Object.entries(vendorRaw ?? {})) {
    const address = key.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      throw new Error(`cost-centre mapping key is not an address: ${key}`);
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`cost-centre mapping value for ${key} must be a non-empty string`);
    }
    vendors[address] = value.trim();
  }
  return { default: fallback, vendors };
}

/** `pay_to` as a vendor key, or the explicit no-vendor bucket. */
export function vendorOf(payTo: string | null | undefined): string {
  const text = (payTo ?? "").trim().toLowerCase();
  return text === "" ? VENDOR_NOT_RECORDED : text;
}

/** The cost centre finance assigned to this vendor, or the documented default. */
export function costCentreFor(vendor: string, map: CostCentreMap): string {
  if (vendor === VENDOR_NOT_RECORDED) return map.default;
  return map.vendors[vendor] ?? map.default;
}

/**
 * A whole-USDC decimal string to integer micro-USDC.
 *
 * `null`/`undefined`/`""` means "not recorded" and returns null. Anything else must be a plain
 * non-negative decimal with at most six fraction digits. No float, no rounding, no exponent.
 */
export function decimalToMinor(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (match === null) {
    throw new Error(`amount is not a non-negative decimal with at most 6 places: ${text}`);
  }
  const fraction = (match[2] ?? "").padEnd(MINOR_UNIT_SCALE, "0");
  return BigInt(match[1]) * MINOR_UNITS_PER_USDC + BigInt(fraction === "" ? "0" : fraction);
}

/** Micro-USDC to a display string, still without floats. `82000n` -> `"0.082000"`. */
export function formatMinor(total: bigint | number): string {
  const value = typeof total === "bigint" ? total : BigInt(total);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(MINOR_UNIT_SCALE + 1, "0");
  const whole = digits.slice(0, -MINOR_UNIT_SCALE);
  const fraction = digits.slice(-MINOR_UNIT_SCALE);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** UTC calendar month of an ISO timestamp, or a refusal to place the row. */
export function periodOf(ts: string): string {
  const millis = Date.parse(ts);
  if (!Number.isFinite(millis)) throw new Error(`timestamp is not parseable: ${ts}`);
  return new Date(millis).toISOString().slice(0, 7);
}

/**
 * `sha256(sorted(ids).join("\n") + "\n")`, lowercase hex.
 *
 * `crypto.subtle` exists in Node and in the Worker runtime, so the page, the endpoint and the ops
 * CLI run the same bytes. An empty id list is not a row and throws.
 */
export async function evidenceHash(ids: readonly string[]): Promise<string> {
  if (ids.length === 0) throw new Error("evidence hash needs at least one decision id");
  const sorted = [...ids].sort();
  const payload = `${sorted.join("\n")}\n`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Group = {
  period: string;
  vendor: string;
  cost_centre: string;
  totalMinor: bigint;
  count: number;
  refusals: number;
  firstMs: number;
  lastMs: number;
  firstTs: string;
  lastTs: string;
  ids: string[];
};

/**
 * Group decisions into accrual rows and return the source summary alongside them.
 *
 * Every included decision id must be unique; a duplicate throws. The summary is computed from the
 * same loop as the rows, so `rows` and `summary` cannot disagree by construction.
 */
export async function buildAccrual(
  decisions: readonly AccrualDecision[],
  map: CostCentreMap,
): Promise<AccrualBuild> {
  const validated = normalizeCostCentreMap(map);
  const groups = new Map<string, Group>();
  const seen = new Set<string>();
  const summary: AccrualSummary = {
    decisions: decisions.length,
    settledProduction: 0,
    settledOtherNetwork: 0,
    settledUnpriced: 0,
    refusals: 0,
    // There is no join key from `events` to `mandates.tenant_id`. This is a measured zero, not an
    // estimate: the export cannot resolve a settled payment to a tenant, so it reports that plainly.
    settledResolvedToTenant: 0,
    settledWithoutTenant: 0,
  };

  for (const decision of decisions) {
    const id = (decision.id ?? "").trim();
    if (id === "") throw new Error("a decision has no id");
    if (seen.has(id)) throw new Error(`decision ${id} appears twice; refusing to double count`);
    seen.add(id);

    const period = periodOf(decision.ts);
    const vendor = vendorOf(decision.pay_to);
    const costCentre = costCentreFor(vendor, validated);

    if (decision.decision === "settled") {
      if ((decision.network ?? "") !== PRODUCTION_NETWORK) {
        summary.settledOtherNetwork += 1;
        continue;
      }
      summary.settledProduction += 1;
      summary.settledWithoutTenant += 1;
      const minor = decimalToMinor(decision.amount_usdc);
      if (minor === null) summary.settledUnpriced += 1;
      const group = groupFor(groups, period, vendor, costCentre, decision);
      group.count += 1;
      group.totalMinor += minor ?? 0n;
      group.ids.push(id);
      continue;
    }

    if (decision.decision === "do_not_pay") {
      summary.refusals += 1;
      const group = groupFor(groups, period, vendor, costCentre, decision);
      group.refusals += 1;
      group.ids.push(id);
      continue;
    }
    // Any other decision is not part of an accrual. The caller queried only the two above.
  }

  const rows: AccrualRow[] = [];
  for (const group of groups.values()) {
    if (group.totalMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("row total exceeds Number.MAX_SAFE_INTEGER; a JSON number would lose precision");
    }
    rows.push({
      period: group.period,
      vendor: group.vendor,
      cost_centre: group.cost_centre,
      currency: ACCRUAL_CURRENCY,
      total_minor: Number(group.totalMinor),
      count: group.count,
      refusals: group.refusals,
      first_ts: group.firstTs,
      last_ts: group.lastTs,
      evidence_hash: await evidenceHash(group.ids),
    });
  }

  rows.sort(
    (a, b) =>
      a.period.localeCompare(b.period) ||
      a.vendor.localeCompare(b.vendor) ||
      a.cost_centre.localeCompare(b.cost_centre),
  );

  return { rows, summary };
}

function groupFor(
  groups: Map<string, Group>,
  period: string,
  vendor: string,
  costCentre: string,
  decision: AccrualDecision,
): Group {
  const key = `${period}\u0000${vendor}\u0000${costCentre}`;
  let group = groups.get(key);
  const millis = Date.parse(decision.ts);
  if (!Number.isFinite(millis)) throw new Error(`timestamp is not parseable: ${decision.ts}`);
  if (group === undefined) {
    group = {
      period,
      vendor,
      cost_centre: costCentre,
      totalMinor: 0n,
      count: 0,
      refusals: 0,
      firstMs: millis,
      lastMs: millis,
      firstTs: decision.ts,
      lastTs: decision.ts,
      ids: [],
    };
    groups.set(key, group);
  }
  if (millis < group.firstMs) {
    group.firstMs = millis;
    group.firstTs = decision.ts;
  }
  if (millis > group.lastMs) {
    group.lastMs = millis;
    group.lastTs = decision.ts;
  }
  return group;
}

/** RFC 4180 quoting, the same rule the decisions export uses. */
export function accrualCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The CSV, with the column contract in `ACCRUAL_COLUMNS`. */
export function buildAccrualCsv(rows: readonly AccrualRow[]): string {
  const lines = [ACCRUAL_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(ACCRUAL_COLUMNS.map((column) => accrualCsvCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `paystage-accrual-2026-11-01_to_2026-11-30.csv` — the range is in the name. */
export function accrualFilename(from: Date, to: Date): string {
  return `paystage-accrual-${isoDay(from)}_to_${isoDay(to)}.csv`;
}

export type AccrualRange = {
  /** Inclusive lower bound, ISO instant. */
  from: string;
  /** Inclusive upper bound, ISO instant. */
  to: string;
  fromDay: string;
  toDay: string;
  filename: string;
};

export type AccrualRangeResult =
  | { ok: true; range: AccrualRange }
  | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBound(raw: string, edge: "start" | "end"): Date | null {
  // A date-only bound is a calendar day and is inclusive on both ends. `to=2026-11-27` at midnight
  // would silently drop that day's decisions.
  const text = DATE_ONLY.test(raw) ? `${raw}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z` : raw;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve `?from=`/`?to=` against the clock. The default is the current UTC month to date, because
 * an accrual is read by month. Invalid or inverted bounds are refused, not coerced.
 */
export function resolveAccrualRange(
  params: URLSearchParams,
  now: Date = new Date(),
): AccrualRangeResult {
  const toRaw = params.get("to");
  const fromRaw = params.get("from");
  const to = toRaw === null ? now : parseBound(toRaw, "end");
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const from = fromRaw === null ? defaultFrom : parseBound(fromRaw, "start");

  if (to === null) return { ok: false, error: "`to` is not a date or an ISO instant" };
  if (from === null) return { ok: false, error: "`from` is not a date or an ISO instant" };
  if (from.getTime() > to.getTime()) return { ok: false, error: "`from` is after `to`" };

  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > MAX_ACCRUAL_DAYS) {
    return { ok: false, error: `the range is longer than ${MAX_ACCRUAL_DAYS} days; narrow it` };
  }

  return {
    ok: true,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      fromDay: isoDay(from),
      toDay: isoDay(to),
      filename: accrualFilename(from, to),
    },
  };
}

function dayOf(iso: string, fallback: Date): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? isoDay(fallback) : isoDay(date);
}

/** The one-line CSV link a manager clicks. Calendar days, so the URL means the same window. */
export function accrualExportHref(fromIso: string, toIso: string): string {
  return `/lab/accrual/export?from=${dayOf(fromIso, new Date())}&to=${dayOf(toIso, new Date())}`;
}

/** The same range as JSON. Same rows, same field names, one request. */
export function accrualJsonHref(fromIso: string, toIso: string): string {
  return `/lab/accrual.json?from=${dayOf(fromIso, new Date())}&to=${dayOf(toIso, new Date())}`;
}
