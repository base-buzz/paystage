/**
 * Payee categories (#310) — a wallet described by facts, never by a verdict.
 *
 * The rule this module exists to enforce is that a category is a **row of observations with provenance**.
 * It is not a score, not a trust level and not an inferred reputation. Every label below is produced from
 * at least one observation that names its source and the date it was read, and the same observations always
 * produce the same output. A field with no observation stays absent; it is never defaulted to a value that
 * would look like a fact.
 *
 * Two consequences are deliberate:
 *
 *  1. **Sources are never merged into one number.** There is no arithmetic here at all. Two sources that
 *     report the same field differently both survive into `observations`, each derived label keeps its own
 *     provenance, and the field also appears in `disagreements` with both values and dates. Nothing picks a
 *     winner, because picking one is the judgement call this item forbids.
 *  2. **Age is read at the time the source was read.** `first_seen` is a date a source published;
 *     `observed_at` is when we read it. The age band is `observed_at - first_seen`, so it does not drift with
 *     the clock and `categorise()` stays a pure function of its input.
 *
 * No network access, no clock, no model. The caller supplies observations; this file only arranges them.
 */

const DAY_MS = 86_400_000;

/** Fields a source can report. These are the only inputs a label may come from. */
export const PAYEE_OBSERVATION_FIELDS = [
  "code",
  "first_seen",
  "nonce",
  "tx_count",
  "holds_asset",
  "sanctions",
  "drainer",
  "non_receivable",
  "goplus",
] as const;

export type PayeeObservationField = (typeof PAYEE_OBSERVATION_FIELDS)[number];

/** The five GoPlus flags this item names, normalised from GoPlus's own field names by the collector. */
export const GOPLUS_FLAGS = [
  "cybercrime",
  "phishing",
  "laundering",
  "sanctioned",
  "blacklist_doubt",
] as const;

export type GoPlusFlag = (typeof GOPLUS_FLAGS)[number];

/**
 * Age bands, as explicit ranges rather than words like "new" or "veteran".
 *
 * A range is a measurement. "New" is an expectation about how a wallet should behave, and this module
 * does not make those. Boundaries are half-open: `<30d`, `30-179d`, `180-729d`, `>=730d`.
 */
export type AgeBand = "<30d" | "30-179d" | "180-729d" | ">=730d";

/** Activity bands from a nonce or transaction count, again as ranges and not as a reputation word. */
export type ActivityBand = "0" | "1-9" | "10-99" | "100-999" | ">=1000";

/** One source's observation of one field. `source` and `observed_at` are the provenance. */
export type PayeeObservation =
  | { readonly source: string; readonly observed_at: string; readonly field: "code"; readonly value: boolean }
  | {
      readonly source: string;
      readonly observed_at: string;
      readonly field: "first_seen";
      readonly value: string;
    }
  | {
      readonly source: string;
      readonly observed_at: string;
      readonly field: "nonce" | "tx_count";
      readonly value: number;
    }
  | {
      readonly source: string;
      readonly observed_at: string;
      readonly field: "holds_asset";
      readonly value: { readonly asset: string; readonly holds: boolean };
    }
  | {
      readonly source: string;
      readonly observed_at: string;
      readonly field: "sanctions" | "drainer" | "non_receivable";
      readonly value: boolean;
    }
  | {
      readonly source: string;
      readonly observed_at: string;
      readonly field: "goplus";
      readonly value: GoPlusFlag;
    };

/** The provenance a label must carry. A non-empty tuple, so a label with no source cannot be typed. */
export type LabelProvenance = readonly [
  { readonly source: string; readonly observed_at: string },
  ...{ readonly source: string; readonly observed_at: string }[],
];

/**
 * Every label is one of these. The key set is exactly `field`, `value`, `provenance`; there is no
 * `score`, `trust`, `risk`, `reputation` or `verdict` field, and adding one would make this union fail
 * the exact-key-set test.
 */
export type PayeeLabel =
  | { readonly field: "kind"; readonly value: "eoa" | "contract"; readonly provenance: LabelProvenance }
  | { readonly field: "age_band"; readonly value: AgeBand; readonly provenance: LabelProvenance }
  | {
      readonly field: "activity_band";
      readonly value: ActivityBand;
      readonly provenance: LabelProvenance;
    }
  | {
      readonly field: "holds_asset";
      readonly value: { readonly asset: string; readonly holds: boolean };
      readonly provenance: LabelProvenance;
    }
  | {
      readonly field: "listed";
      readonly value: "sanctions" | "drainer" | "non_receivable";
      readonly provenance: LabelProvenance;
    }
  | { readonly field: "goplus"; readonly value: GoPlusFlag; readonly provenance: LabelProvenance };

/**
 * A field two sources claim differently. Both values and both dates are kept; this type cannot hold a
 * resolved value, only the disagreement itself.
 */
export interface PayeeDisagreement {
  readonly field: PayeeObservationField;
  readonly values: readonly [
    { readonly value: unknown; readonly source: string; readonly observed_at: string },
    { readonly value: unknown; readonly source: string; readonly observed_at: string },
    ...{ readonly value: unknown; readonly source: string; readonly observed_at: string }[],
  ];
}

/** The complete output shape. Exactly three keys, and no aggregate score. */
export interface PayeeCategories {
  readonly labels: readonly PayeeLabel[];
  readonly observations: readonly PayeeObservation[];
  readonly disagreements: readonly PayeeDisagreement[];
}

export class InvalidPayeeObservationError extends Error {
  constructor(index: number, detail: string) {
    super(`observation ${index}: ${detail}`);
    this.name = "InvalidPayeeObservationError";
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text;
}

function nonEmpty(value: unknown, what: string, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidPayeeObservationError(index, `${what} must be a non-empty string`);
  }
  return value.trim();
}

function parseTimestamp(value: string, what: string, index: number): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidPayeeObservationError(index, `${what} is not a parseable date: ${value}`);
  }
  return parsed;
}

/** Age in days, floor. Exported because the boundaries are part of the contract and are tested directly. */
export function ageBand(firstSeen: string, observedAt: string): AgeBand {
  const first = Date.parse(firstSeen);
  const read = Date.parse(observedAt);
  if (!Number.isFinite(first)) throw new Error(`first_seen is not a parseable date: ${firstSeen}`);
  if (!Number.isFinite(read)) throw new Error(`observed_at is not a parseable date: ${observedAt}`);
  if (first > read) throw new Error("first_seen is after observed_at; a wallet cannot be seen before it was read");
  const days = Math.floor((read - first) / DAY_MS);
  if (days < 30) return "<30d";
  if (days < 180) return "30-179d";
  if (days < 730) return "180-729d";
  return ">=730d";
}

/** Activity band from a non-negative integer count. The boundaries are exported through the return type. */
export function activityBand(count: number): ActivityBand {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`activity count must be a non-negative integer, received ${String(count)}`);
  }
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  if (count < 1000) return "100-999";
  return ">=1000";
}

/**
 * Validate and canonicalise one observation. A blank source or an unparseable date is an error, not a
 * silently dropped row: the whole point of the item is that an unlabelled fact is not allowed.
 */
function normaliseObservation(raw: PayeeObservation, index: number): PayeeObservation {
  if (raw === null || typeof raw !== "object") {
    throw new InvalidPayeeObservationError(index, "not an object");
  }
  const source = nonEmpty(raw.source, "source", index);
  const observedAt = nonEmpty(raw.observed_at, "observed_at", index);
  parseTimestamp(observedAt, "observed_at", index);

  switch (raw.field) {
    case "code": {
      if (typeof raw.value !== "boolean") {
        throw new InvalidPayeeObservationError(index, "code value must be a boolean (true = code present)");
      }
      return { source, observed_at: observedAt, field: "code", value: raw.value };
    }
    case "first_seen": {
      if (typeof raw.value !== "string") {
        throw new InvalidPayeeObservationError(index, "first_seen value must be a date string");
      }
      const firstSeen = raw.value.trim();
      parseTimestamp(firstSeen, "first_seen", index);
      return { source, observed_at: observedAt, field: "first_seen", value: firstSeen };
    }
    case "nonce":
    case "tx_count": {
      if (!Number.isInteger(raw.value) || raw.value < 0) {
        throw new InvalidPayeeObservationError(index, `${raw.field} value must be a non-negative integer`);
      }
      return { source, observed_at: observedAt, field: raw.field, value: raw.value };
    }
    case "holds_asset": {
      const value = raw.value;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new InvalidPayeeObservationError(index, "holds_asset value must be { asset, holds }");
      }
      if (typeof value.asset !== "string" || value.asset.trim() === "") {
        throw new InvalidPayeeObservationError(index, "holds_asset.asset must be a non-empty string");
      }
      if (typeof value.holds !== "boolean") {
        throw new InvalidPayeeObservationError(index, "holds_asset.holds must be a boolean");
      }
      return {
        source,
        observed_at: observedAt,
        field: "holds_asset",
        value: { asset: value.asset.trim(), holds: value.holds },
      };
    }
    case "sanctions":
    case "drainer":
    case "non_receivable": {
      if (typeof raw.value !== "boolean") {
        throw new InvalidPayeeObservationError(index, "list flag value must be a boolean");
      }
      return { source, observed_at: observedAt, field: raw.field, value: raw.value };
    }
    case "goplus": {
      if (typeof raw.value !== "string" || !(GOPLUS_FLAGS as readonly string[]).includes(raw.value)) {
        throw new InvalidPayeeObservationError(
          index,
          `goplus value must be one of ${GOPLUS_FLAGS.join(", ")}`,
        );
      }
      return { source, observed_at: observedAt, field: "goplus", value: raw.value as GoPlusFlag };
    }
    default: {
      const field = (raw as { field?: unknown }).field;
      throw new InvalidPayeeObservationError(index, `unknown field: ${String(field)}`);
    }
  }
}

function compareObservation(a: PayeeObservation, b: PayeeObservation): number {
  return (
    compareStrings(a.field, b.field) ||
    compareStrings(a.source, b.source) ||
    compareStrings(a.observed_at, b.observed_at) ||
    compareStrings(canonicalJson(a.value), canonicalJson(b.value))
  );
}

interface LabelDraft {
  field: PayeeLabel["field"];
  value: PayeeLabel["value"];
  provenance: { source: string; observed_at: string }[];
}

/**
 * Turn observations into labels. One label per distinct (label field, value); the value's provenance is
 * every observation that produced it. Conflicting values therefore produce two labels, not a winner.
 */
export function categorise(observations: readonly PayeeObservation[]): PayeeCategories {
  const normalised = observations
    .map((observation, index) => normaliseObservation(observation, index))
    .sort(compareObservation);

  const labels = new Map<string, LabelDraft>();

  const addLabel = (
    field: PayeeLabel["field"],
    value: PayeeLabel["value"],
    observation: PayeeObservation,
  ): void => {
    const key = `${field}\u0000${canonicalJson(value)}`;
    const existing = labels.get(key);
    if (existing !== undefined) {
      const provenance = { source: observation.source, observed_at: observation.observed_at };
      if (
        !existing.provenance.some(
          (entry) => entry.source === provenance.source && entry.observed_at === provenance.observed_at,
        )
      ) {
        existing.provenance.push(provenance);
      }
      return;
    }
    labels.set(key, {
      field,
      value,
      provenance: [{ source: observation.source, observed_at: observation.observed_at }],
    });
  };

  for (const observation of normalised) {
    switch (observation.field) {
      case "code":
        addLabel("kind", observation.value ? "contract" : "eoa", observation);
        break;
      case "first_seen":
        addLabel("age_band", ageBand(observation.value, observation.observed_at), observation);
        break;
      case "nonce":
      case "tx_count":
        addLabel("activity_band", activityBand(observation.value), observation);
        break;
      case "holds_asset":
        addLabel(
          "holds_asset",
          { asset: observation.value.asset, holds: observation.value.holds },
          observation,
        );
        break;
      case "sanctions":
      case "drainer":
      case "non_receivable":
        // Only a positive listing becomes a label. A `false` is kept as an observation, but "not on this
        // list" is not "cleared" and this module will not dress absence up as one.
        if (observation.value) addLabel("listed", observation.field, observation);
        break;
      case "goplus":
        addLabel("goplus", observation.value, observation);
        break;
    }
  }

  const renderedLabels: PayeeLabel[] = [...labels.values()]
    .sort(
      (a, b) =>
        compareStrings(a.field, b.field) ||
        compareStrings(canonicalJson(a.value), canonicalJson(b.value)),
    )
    .map((draft) => {
      draft.provenance.sort(
        (a, b) => compareStrings(a.source, b.source) || compareStrings(a.observed_at, b.observed_at),
      );
      return {
        field: draft.field,
        value: draft.value,
        provenance: draft.provenance as unknown as LabelProvenance,
      } as PayeeLabel;
    });

  const byField = new Map<PayeeObservationField, PayeeObservation[]>();
  for (const observation of normalised) {
    const group = byField.get(observation.field);
    if (group === undefined) byField.set(observation.field, [observation]);
    else group.push(observation);
  }

  const disagreements: PayeeDisagreement[] = [];
  for (const [field, group] of byField) {
    const sources = new Set(group.map((observation) => observation.source));
    const values = new Set(group.map((observation) => canonicalJson(observation.value)));
    // Two *sources* claiming the same field differently. A single source read twice at different times is
    // a change over time, not a disagreement between sources; it still appears as separate labels.
    if (sources.size < 2 || values.size < 2) continue;
    const valuesWithProvenance = group
      .map((observation) => ({
        value: observation.value,
        source: observation.source,
        observed_at: observation.observed_at,
      }))
      .sort(
        (a, b) =>
          compareStrings(a.source, b.source) ||
          compareStrings(a.observed_at, b.observed_at) ||
          compareStrings(canonicalJson(a.value), canonicalJson(b.value)),
      );
    disagreements.push({
      field,
      values: valuesWithProvenance as unknown as PayeeDisagreement["values"],
    });
  }
  disagreements.sort((a, b) => compareStrings(a.field, b.field));

  return { labels: renderedLabels, observations: normalised, disagreements };
}
