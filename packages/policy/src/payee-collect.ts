/**
 * Collector support for #356 — the pure half of `bin/payee-collect.mjs`.
 *
 * The classifier in `payee-category.ts` deliberately refuses GoPlus's raw keys, so *something* has to own the
 * translation from GoPlus's field names to the five normalised flags. It lives here, beside the names it translates
 * to, so a rename in either place breaks one module and one test rather than a script two directories away.
 *
 * The second rule this module enforces is the one that is easy to get wrong in a collector: **a source that did not
 * answer is `unknown`, not `false`.** `collectSource()` is the only way the collector builds rows; on a thrown read it
 * returns no observations and a report saying `unknown`. A missing GoPlus key is likewise reported as `missing` and
 * never translated into a negative observation. Nothing here touches the network — the caller injects `read()`, which
 * is what makes the failure path testable without a mock server.
 */

import {
  GOPLUS_FLAGS,
  type GoPlusFlag,
  type PayeeObservation,
  type PayeeObservationField,
} from "./payee-category.js";

/** The five GoPlus raw keys this product recognises, and the normalised name each one becomes. */
export const GOPLUS_RAW_TO_NORMALISED: Readonly<Record<string, GoPlusFlag>> = Object.freeze({
  cybercrime: "cybercrime",
  phishing_activities: "phishing",
  money_laundering: "laundering",
  sanctioned: "sanctioned",
  blacklist_doubt: "blacklist_doubt",
});

/** The raw keys, in the order GoPlus documents them. Used by the collector to report which keys were absent. */
export const GOPLUS_RAW_KEYS: readonly string[] = Object.freeze(
  Object.keys(GOPLUS_RAW_TO_NORMALISED),
);

/** Raw key → normalised flag. Undefined means "not one of the five", never "false". */
export function normaliseGoPlusKey(rawKey: string): GoPlusFlag | undefined {
  return GOPLUS_RAW_TO_NORMALISED[rawKey];
}

export interface GoPlusMapping {
  /** Normalised flags the feed set to positive ("1"), in `GOPLUS_FLAGS` order. */
  readonly flags: readonly GoPlusFlag[];
  /** Recognised raw keys the feed did not include. Absent is unknown, not a negative fact. */
  readonly missing: readonly string[];
  /** Positive raw keys outside the five. Surfaced so they are not silently discarded. */
  readonly unrecognised: readonly string[];
  /** Recognised keys whose value is neither "0"/0 nor "1"/1. Treated as unknown, not false. */
  readonly malformed: readonly string[];
}

function isPositive(value: unknown): boolean {
  return value === "1" || value === 1;
}

function isNegative(value: unknown): boolean {
  return value === "0" || value === 0;
}

/**
 * Map GoPlus's raw result object to the five normalised flags. Only an explicit positive value becomes a flag;
 * `"0"` is a negative answered by the source (kept out of `flags`, not `missing`), a missing key is `missing`, and
 * anything else is `malformed`. Every one of those distinctions is deliberate: a collector that treats a missing
 * key as `false` turns an outage into a clean bill of health.
 */
export function mapGoPlusResult(result: Readonly<Record<string, unknown>>): GoPlusMapping {
  const flags: GoPlusFlag[] = [];
  const missing: string[] = [];
  const unrecognised: string[] = [];
  const malformed: string[] = [];

  for (const rawKey of GOPLUS_RAW_KEYS) {
    if (!(rawKey in result)) {
      missing.push(rawKey);
      continue;
    }
    const value = result[rawKey];
    if (isPositive(value)) {
      const flag = normaliseGoPlusKey(rawKey);
      if (flag !== undefined && !flags.includes(flag)) flags.push(flag);
    } else if (!isNegative(value)) {
      malformed.push(rawKey);
    }
  }

  for (const [rawKey, value] of Object.entries(result)) {
    if (rawKey in GOPLUS_RAW_TO_NORMALISED) continue;
    if (isPositive(value)) unrecognised.push(rawKey);
  }

  // Stable order regardless of feed ordering, so two runs over the same body produce identical rows.
  flags.sort((a, b) => GOPLUS_FLAGS.indexOf(a) - GOPLUS_FLAGS.indexOf(b));
  return { flags, missing, unrecognised, malformed };
}

/**
 * One `goplus` observation per positive flag. A negative or missing flag produces no row at all: the classifier's
 * `goplus` value is a flag that was set, and inventing `false` here is exactly the failure the item names.
 */
export function goPlusObservations(
  mapping: GoPlusMapping,
  source: string,
  observedAt: string,
): PayeeObservation[] {
  return mapping.flags.map((flag) => ({
    source,
    observed_at: observedAt,
    field: "goplus" as const,
    value: flag,
  }));
}

/** What one source did. `unknown` means the source was asked and did not answer, never "clean". */
export interface SourceReport {
  readonly source: string;
  readonly status: "observed" | "unknown";
  readonly observed_at: string;
  readonly fields: readonly PayeeObservationField[];
  readonly detail: string;
}

export interface SourceResult {
  readonly report: SourceReport;
  readonly observations: readonly PayeeObservation[];
}

export interface SourceSpec<T> {
  readonly source: string;
  readonly observed_at: string;
  readonly fields: readonly PayeeObservationField[];
  readonly read: () => Promise<T>;
  readonly toObservations: (value: T) => readonly PayeeObservation[];
  /** Optional one-line description of what was read, for the report beside the source. */
  readonly describe?: (value: T) => string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one source, and turn any failure into an `unknown` report with **zero observations**.
 *
 * Two guards keep provenance honest even when `toObservations` is wrong: every row must carry this source's name and
 * one of this source's declared fields. A row that fails that check downgrades the whole source to `unknown` rather
 * than entering the output with an unattributable provenance.
 */
export async function collectSource<T>(spec: SourceSpec<T>): Promise<SourceResult> {
  let value: T;
  try {
    value = await spec.read();
  } catch (error) {
    return {
      report: {
        source: spec.source,
        status: "unknown",
        observed_at: spec.observed_at,
        fields: spec.fields,
        detail: `source did not answer: ${errorMessage(error)}`,
      },
      observations: [],
    };
  }

  let observations: readonly PayeeObservation[];
  try {
    observations = spec.toObservations(value);
  } catch (error) {
    return {
      report: {
        source: spec.source,
        status: "unknown",
        observed_at: spec.observed_at,
        fields: spec.fields,
        detail: `source answered but could not be read: ${errorMessage(error)}`,
      },
      observations: [],
    };
  }

  for (const observation of observations) {
    if (observation.source !== spec.source) {
      return {
        report: {
          source: spec.source,
          status: "unknown",
          observed_at: spec.observed_at,
          fields: spec.fields,
          detail: `source produced an observation attributed to ${JSON.stringify(observation.source)}`,
        },
        observations: [],
      };
    }
    if (!spec.fields.includes(observation.field)) {
      return {
        report: {
          source: spec.source,
          status: "unknown",
          observed_at: spec.observed_at,
          fields: spec.fields,
          detail: `source produced an undeclared field ${JSON.stringify(observation.field)}`,
        },
        observations: [],
      };
    }
  }

  return {
    report: {
      source: spec.source,
      status: "observed",
      observed_at: spec.observed_at,
      fields: spec.fields,
      detail: spec.describe?.(value) ?? `${observations.length} observation(s)`,
    },
    observations,
  };
}
