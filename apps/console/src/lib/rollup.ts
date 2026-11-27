/**
 * Read-side model for the org-unit roll-up (#471).
 *
 * The division total on `/lab/refusals` is rendered from `GET /v1/public/rollup?unit=…` — this module
 * is the only place that endpoint's body is parsed. It does not read Supabase and it does not compute a
 * total: if the endpoint cannot answer, the page says so and shows no number. A page-side re-aggregation
 * would be a second implementation of the subtree arithmetic, and the first time the two disagreed a
 * manager would be looking at the wrong one.
 *
 * The parser keeps only the fields the panel renders, and it refuses a body that claims a spend total
 * and an unavailable reason at the same time. That combination is a contract bug, and rendering it
 * would put a number beside the sentence saying the number does not exist.
 */

export const DEFAULT_ROLLUP_API = "https://api.paystage.xyz";
/** The default division on a single-tenant install; the page's unit is configuration, not a guess. */
export const DEFAULT_ROLLUP_UNIT = "paystage";

/** Same grammar as `apps/hosted/src/org-unit.ts`; a test reads both files and fails if they drift. */
export const ORG_UNIT_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,7}$/;

export interface RollupUnitTotal {
  unit: string;
  mandates: number;
  spend_minor: number;
}

export interface RollupPayload {
  unit: string;
  spend_minor: number;
  spend_currency: "USDC";
  refusals: number;
  mandates: number;
  descendants: RollupUnitTotal[];
  as_of: string;
  spend_unavailable_reason?: string;
  refusals_unavailable_reason?: string;
  spend_unpriced_settled?: number;
}

export type RollupRead =
  | { kind: "record"; payload: RollupPayload; apiBase: string }
  | { kind: "unreadable"; unit: string; reason: string; apiBase: string };

export function rollupApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PAYSTAGE_API || DEFAULT_ROLLUP_API).replace(/\/+$/, "");
}

export function rollupUnit(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.PAYSTAGE_ROLLUP_UNIT ?? "").trim();
  return configured === "" ? DEFAULT_ROLLUP_UNIT : configured;
}

export function rollupUrl(unit: string, apiBase: string = DEFAULT_ROLLUP_API): string {
  return `${apiBase.replace(/\/+$/, "")}/v1/public/rollup?unit=${encodeURIComponent(unit)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseUnitTotal(value: unknown): RollupUnitTotal | null {
  if (!isRecord(value)) return null;
  if (typeof value.unit !== "string" || !ORG_UNIT_RE.test(value.unit)) return null;
  if (!isCount(value.mandates) || !isCount(value.spend_minor)) return null;
  return { unit: value.unit, mandates: value.mandates, spend_minor: value.spend_minor };
}

/**
 * Validate the subset the panel renders. Extra endpoint fields are dropped, not passed through.
 *
 * `spend_minor` is an integer of micro-USDC. A reason is allowed only beside a zero: if the endpoint
 * ever sends a positive total and says it could not compute one, this parser refuses the body rather
 * than choosing which sentence to believe.
 */
export function parseRollupPayload(raw: unknown): RollupPayload | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.unit !== "string" || !ORG_UNIT_RE.test(raw.unit)) return null;
  if (!isCount(raw.spend_minor)) return null;
  if (raw.spend_currency !== "USDC") return null;
  if (!isCount(raw.refusals) || !isCount(raw.mandates)) return null;
  if (typeof raw.as_of !== "string" || !Number.isFinite(Date.parse(raw.as_of))) return null;
  if (!Array.isArray(raw.descendants)) return null;

  const descendants: RollupUnitTotal[] = [];
  for (const entry of raw.descendants) {
    const parsed = parseUnitTotal(entry);
    if (parsed === null) return null;
    descendants.push(parsed);
  }

  const spendReason = raw.spend_unavailable_reason;
  if (spendReason !== undefined && (typeof spendReason !== "string" || spendReason.trim() === "")) return null;
  if (spendReason !== undefined && raw.spend_minor !== 0) return null;

  const refusalsReason = raw.refusals_unavailable_reason;
  if (refusalsReason !== undefined && (typeof refusalsReason !== "string" || refusalsReason.trim() === "")) {
    return null;
  }
  if (refusalsReason !== undefined && raw.refusals !== 0) return null;

  let unpriced: number | undefined;
  if (raw.spend_unpriced_settled !== undefined) {
    if (!isCount(raw.spend_unpriced_settled)) return null;
    unpriced = raw.spend_unpriced_settled;
  }

  const payload: RollupPayload = {
    unit: raw.unit,
    spend_minor: raw.spend_minor,
    spend_currency: "USDC",
    refusals: raw.refusals,
    mandates: raw.mandates,
    descendants,
    as_of: raw.as_of,
  };
  if (typeof spendReason === "string") payload.spend_unavailable_reason = spendReason;
  if (typeof refusalsReason === "string") payload.refusals_unavailable_reason = refusalsReason;
  if (unpriced !== undefined) payload.spend_unpriced_settled = unpriced;
  return payload;
}

/**
 * Read the one endpoint. A transport failure, a non-2xx answer, invalid JSON or a body that fails the
 * parser all become `unreadable` — never a zero payload.
 */
export async function fetchRollup(
  unit: string,
  options: { apiBase?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<RollupRead> {
  const apiBase = (options.apiBase ?? rollupApiBase()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!ORG_UNIT_RE.test(unit)) {
    return { kind: "unreadable", unit, reason: "the configured unit is not a valid org-unit path", apiBase };
  }

  let res: Response;
  try {
    res = await fetchImpl(rollupUrl(unit, apiBase), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
  } catch (error) {
    return {
      kind: "unreadable",
      unit,
      reason: `the roll-up endpoint did not answer (${error instanceof Error ? error.message : String(error)})`,
      apiBase,
    };
  }

  if (!res.ok) {
    return { kind: "unreadable", unit, reason: `the roll-up endpoint answered HTTP ${res.status}`, apiBase };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "unreadable", unit, reason: "the roll-up endpoint did not return JSON", apiBase };
  }

  const payload = parseRollupPayload(raw);
  if (payload === null) {
    return { kind: "unreadable", unit, reason: "the roll-up response did not match its contract", apiBase };
  }
  if (payload.unit !== unit) {
    // A response about another unit is not this page's total.
    return { kind: "unreadable", unit, reason: `the roll-up answered for ${payload.unit}, not ${unit}`, apiBase };
  }
  return { kind: "record", payload, apiBase };
}

/** Format integer micro-USDC as a USDC decimal string. Integer division only; no float. */
export function formatMinorUsdc(minor: number): string {
  const value = BigInt(minor);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction === "" ? `${whole}` : `${whole}.${fraction}`;
}
