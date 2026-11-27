/**
 * Refusals (#472): group `decision = do_not_pay` by the rule that fired and by payer.
 *
 * This module is pure so the shape can be tested without a database. The page feeds it rows read from
 * `public.events`; the ops digest in `/work/ops/bin/refusal-digest.mjs` implements the same expansion for
 * its own process. Keeping the expansion here means the page and its test agree on one interpretation.
 *
 * `reason_codes` is a Postgres `text[]`, so PostgREST normally returns an array — but the same column has
 * been seen as a JSON string and as a comma list in snapshots and fixtures. Expansion accepts all three,
 * plus Postgres' `{a,b}` array literal, and dedupes within a row: a refusal that names the same rule twice
 * is still one refusal for that rule.
 */

export const REFUSAL_DECISION = "do_not_pay";
/** The digest default and the window this page renders unless a caller says otherwise. */
export const REFUSAL_WINDOW_DAYS = 7;
export const REFUSAL_CONTROL_LINE =
  "A refusal is not a failed payment — it is the control working.";
/** Bucket for rows whose `reason_codes` is empty. Never invent a rule to make the table look complete. */
export const RULE_NOT_RECORDED = "not recorded";
/** Bucket for rows with no payer address. */
export const PAYER_NOT_RECORDED = "not recorded";

/** The labels the project records provenance with (AGENTS.md rule 3). */
export const PROVENANCE_LABELS = [
  "dev-loadgen",
  "our-probe",
  "operator-agent",
  "unknown-agent",
] as const;

export type RefusalRow = {
  id?: string;
  ts: string;
  source?: string | null;
  payer?: string | null;
  reason_codes?: unknown;
  caller_provenance?: string | null;
  tool?: string | null;
};

export type CountRow = { label: string; count: number };

export type RefusalView = {
  days: number;
  /** Requested window, not the span the rows cover. */
  windowStart: string;
  windowEnd: string;
  /** First and last refusal actually read, or null when the window is empty. */
  firstRefusal: string | null;
  lastRefusal: string | null;
  total: number;
  rules: CountRow[];
  /** Rule counts can exceed `total`: one refusal may name more than one rule. */
  ruleTotal: number;
  rulesNotRecorded: number;
  payers: CountRow[];
  distinctPayers: number;
  /** One sentence when the payer grouping cannot represent a population, null otherwise. */
  payerCaveat: string | null;
  /** One sentence when some refusals carry no rule at all, null otherwise. */
  ruleCaveat: string | null;
  sources: CountRow[];
  /** The finer #430 label, mapped onto the project's four provenance labels. */
  provenance: CountRow[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clean(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, "").trim();
}

function splitList(text: string): string[] {
  return text
    .split(/[,;]/)
    .map(clean)
    .filter(Boolean);
}

/**
 * Expand one `reason_codes` value into the rules it names.
 *
 * Handles: null/undefined, `string[]`, a JSON-encoded array (`'["a","b"]'`), a comma/semicolon list, a
 * Postgres array literal (`'{a,b}'`), and a scalar string. Anything else contributes nothing rather
 * than a stringified object.
 */
export function expandReasonCodes(raw: unknown): string[] {
  const walk = (value: unknown, depth: number): string[] => {
    if (value === null || value === undefined || depth > 3) return [];
    if (Array.isArray(value)) return value.flatMap((item) => walk(item, depth + 1));
    if (typeof value !== "string") return [];
    const text = value.trim();
    if (text === "") return [];

    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed !== value) return walk(parsed, depth + 1);
      } catch {
        // Not JSON. A Postgres array literal is the remaining brace shape.
        if (text.startsWith("{") && text.endsWith("}")) return splitList(text.slice(1, -1));
      }
    }
    return splitList(text);
  };

  return unique(walk(raw, 0).map(clean).filter(Boolean));
}

/** Six and four characters is enough to tell two addresses apart and not enough to hand one on. */
export function maskPayer(payer: string): string {
  const text = payer.trim();
  if (text.length <= 12) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

/**
 * Map the #430 caller label onto the project's provenance vocabulary.
 *
 * `own-ci` is work this project generated on purpose, so it folds into `dev-loadgen`; the site has no
 * fifth label and inventing one would be a vocabulary of one.
 */
export function provenanceLabel(raw: string | null | undefined): string {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "own-loadgen":
    case "dev-loadgen":
    case "own-ci":
      return "dev-loadgen";
    case "own-probe":
    case "our-probe":
      return "our-probe";
    case "operator-agent":
      return "operator-agent";
    default:
      return "unknown-agent";
  }
}

function countRows(map: Map<string, number>, order: (a: [string, number], b: [string, number]) => number): CountRow[] {
  return [...map.entries()]
    .sort(order)
    .map(([label, count]) => ({ label, count }));
}

const byCountDesc = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);

export function buildRefusalView(
  rows: RefusalRow[],
  options: { days?: number; now?: Date } = {},
): RefusalView {
  const days = options.days ?? REFUSAL_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const windowEndMs = now.getTime();
  const windowStartMs = windowEndMs - days * 86_400_000;

  const inWindow = rows
    .map((row) => ({ row, at: Date.parse(row.ts) }))
    .filter(({ at }) => Number.isFinite(at) && at >= windowStartMs && at <= windowEndMs)
    .sort((a, b) => a.at - b.at);

  const ruleCounts = new Map<string, number>();
  const payerAddresses = new Map<string, string>(); // lowercase address -> masked label
  const payerCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const provenanceCounts = new Map<string, number>();

  for (const { row } of inWindow) {
    const codes = expandReasonCodes(row.reason_codes);
    if (codes.length === 0) {
      ruleCounts.set(RULE_NOT_RECORDED, (ruleCounts.get(RULE_NOT_RECORDED) ?? 0) + 1);
    } else {
      for (const code of codes) ruleCounts.set(code, (ruleCounts.get(code) ?? 0) + 1);
    }

    const payer = (row.payer ?? "").trim();
    if (payer === "") {
      payerCounts.set(PAYER_NOT_RECORDED, (payerCounts.get(PAYER_NOT_RECORDED) ?? 0) + 1);
    } else {
      const address = payer.toLowerCase();
      const label = payerAddresses.get(address) ?? maskPayer(payer);
      payerAddresses.set(address, label);
      payerCounts.set(label, (payerCounts.get(label) ?? 0) + 1);
    }

    const source = (row.source ?? "").trim() || "unknown";
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    const label = provenanceLabel(row.caller_provenance);
    provenanceCounts.set(label, (provenanceCounts.get(label) ?? 0) + 1);
  }

  const total = inWindow.length;
  const distinctPayers = payerAddresses.size;
  const rulesNotRecorded = ruleCounts.get(RULE_NOT_RECORDED) ?? 0;
  const ruleTotal = [...ruleCounts.values()].reduce((sum, count) => sum + count, 0);

  const payerCaveat =
    distinctPayers === 1
      ? "One payer accounts for every refusal in this window; the by-payer grouping is that payer's traffic and a placeholder until more payers appear."
      : distinctPayers === 0
        ? "No refusal in this window records a payer address, so the by-payer grouping cannot name anyone yet; it is a placeholder until refusals carry a payer."
        : null;

  const ruleCaveat =
    rulesNotRecorded > 0
      ? `${rulesNotRecorded} of ${total} refusals carry no reason code, so the rule that fired is not recorded in \`reason_codes\` and those rows are counted as "${RULE_NOT_RECORDED}" rather than assigned a guess.`
      : null;

  return {
    days,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    firstRefusal: inWindow[0]?.row.ts ?? null,
    lastRefusal: inWindow.at(-1)?.row.ts ?? null,
    total,
    rules: countRows(ruleCounts, byCountDesc),
    ruleTotal,
    rulesNotRecorded,
    payers: countRows(payerCounts, byCountDesc),
    distinctPayers,
    payerCaveat,
    ruleCaveat,
    sources: countRows(sourceCounts, byCountDesc),
    provenance: countRows(provenanceCounts, byCountDesc),
  };
}

/** A stable, human-readable date for a timestamp that may be null. */
export function formatRefusalTime(iso: string | null): string {
  if (iso === null) return "—";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(".000Z", "Z") : iso;
}

export function formatRange(view: RefusalView): string {
  return `${formatRefusalTime(view.firstRefusal ?? view.windowStart)} → ${formatRefusalTime(
    view.lastRefusal ?? view.windowEnd,
  )}`;
}
