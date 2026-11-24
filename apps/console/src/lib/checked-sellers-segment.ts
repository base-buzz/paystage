/**
 * The "uncensored inference" class segment on `/lists` (#398).
 *
 * The segment is a payment-safety measurement of 55 hosts whose listings use the class's own vocabulary. Every number,
 * the date, the method and the class definition are rendered from the generated record — never typed in JSX. The record
 * is produced by `ops/bin/checked-sellers-segment.mjs` (sweep + documented probe + the shared payee-screening path) and
 * copied by `scripts/gen-checked-sellers-segment.mjs`, whose `--check` fails when the committed copy drifts.
 *
 * The one sentence this module may never lose: membership is **self-description**, and the segment measures payment
 * safety, not content policy or behaviour. A keyword match is not evidence that a provider will serve anything in
 * particular, and the sweep does not test that.
 */
import generated from "@/lib/checked-sellers-segment.generated.json";
import { formatCount } from "@/lib/market-demand";

export interface SegmentRow {
  host: string;
  calls30d: number;
  endpoint: string;
  entriesMatched: number;
  verifiedOn: string;
  method: string;
  advertisedPriceUsd: number | null;
  askedPriceUsd: number | null;
  payee: string | null;
  screening: "ofac" | "drainer" | "clear-of-lists" | "unrecognised-address" | "none" | string;
  correct402: boolean;
  priceCompared: boolean;
  priceMatched: boolean;
  status: number;
  reason: string;
}

export interface SegmentSnapshot {
  segment: string;
  title: string;
  measuredOn: string;
  timeZone: string;
  method: string;
  predicate: string;
  classDefinition: {
    basis: string;
    fields: string[];
    keywords: string[];
    statement: string;
  };
  choiceRule: string;
  denominator: {
    hosts: number;
    endpoints: number;
    oneEndpointPerHost: boolean;
    matchedEntries: number;
    catalogueEntries: number;
    catalogueMeasuredAt: string;
  };
  budget: {
    requestCap: number;
    requests: number;
    getProbes: number;
    postRetries: number;
    timeoutMs: number;
  };
  result: {
    correct402: number;
    no402: number;
    error: number;
    priceCompared: number;
    priceMatched: number;
    screenedClear: number;
    screenedFlagged: number;
    screenedNone: number;
  };
  killCriterion: {
    rule: string;
    threshold: number;
    fired: boolean;
    finding: string;
  };
  rows: SegmentRow[];
}

export const CHECKED_SELLERS_SEGMENT: SegmentSnapshot = generated;

/**
 * The self-description sentence. Printed in full on the page and never shortened to "uncensored hosts": that would
 * turn a keyword match into a claim about behaviour, which is the one thing the sweep cannot support.
 */
export function segmentSelfDescription(snapshot: SegmentSnapshot): string {
  const keywords = snapshot.classDefinition.keywords.join(", ");
  return `Membership of this segment is self-description: each host matched one of the sweep keywords — ${keywords} — in its own listing text, so this segment measures payment safety — does the endpoint answer a correct 402, charge the price it advertised, and name a payee our lists clear — and not content policy, censorship resistance, or what any provider will serve.`;
}

/** Date, denominator and method in one sentence, all from the record. */
export function segmentMethod(snapshot: SegmentSnapshot): string {
  const { denominator } = snapshot;
  return `On ${snapshot.measuredOn} (${snapshot.timeZone}) a read-only re-run of the keyword sweep read ${formatCount(denominator.catalogueEntries)} entries in the Bazaar discovery index and matched ${formatCount(denominator.matchedEntries)} entries on ${formatCount(denominator.hosts)} hosts by their own listing text; one endpoint per host was probed — ${snapshot.choiceRule} — with one GET and one POST retry on an error status, inside the ${formatCount(snapshot.budget.requestCap)}-request cap, and every 402 was judged by isCorrectChallenge from the built @paystage/x402-guard.`;
}

export function segmentSummaries(snapshot: SegmentSnapshot): string[] {
  const { result, denominator } = snapshot;
  return [
    `${formatCount(result.correct402)} of ${formatCount(denominator.hosts)} hosts answered a correct 402`,
    `${formatCount(result.priceMatched)} of ${formatCount(result.priceCompared)} advertised prices matched the price asked`,
    `${formatCount(result.screenedClear)} of ${formatCount(denominator.hosts)} challenged payees were clear of the OFAC and known-drainer lists (${formatCount(result.screenedFlagged)} flagged, ${formatCount(result.screenedNone)} had no payee to screen)`,
  ];
}

/** The kill criterion, stated before its result so a reader can check the rule that decided the headline. */
export function segmentKillCriterion(snapshot: SegmentSnapshot): string {
  const { killCriterion, result, denominator } = snapshot;
  return killCriterion.fired
    ? `The kill criterion fired: ${formatCount(result.correct402)} of ${formatCount(denominator.hosts)} hosts answer a correct 402, fewer than half, so ${killCriterion.finding}.`
    : `The kill criterion did not fire: it asked whether fewer than half of the ${formatCount(denominator.hosts)} hosts answer a correct 402, and ${formatCount(result.correct402)} do. ${killCriterion.finding}.`;
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "not recorded";
  const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${fixed}`;
}

export function segmentCorrectLabel(row: SegmentRow): string {
  return row.correct402
    ? "correct 402"
    : `not a correct 402 — ${row.reason || `HTTP ${row.status}`}`;
}

/** Keeps the page's single "Advertised price" column; the asked price and the comparison live in the same cell. */
export function segmentPriceLabel(row: SegmentRow): string {
  if (!row.correct402) return "no challenge — not compared";
  if (!row.priceCompared || row.advertisedPriceUsd === null || row.askedPriceUsd === null) {
    return `${usd(row.advertisedPriceUsd)} advertised — asked price not parseable`;
  }
  return `${usd(row.advertisedPriceUsd)} advertised / ${usd(row.askedPriceUsd)} asked — ${row.priceMatched ? "matched" : "did not match"}`;
}

export function segmentScreeningLabel(row: SegmentRow): string {
  switch (row.screening) {
    case "ofac":
      return "on the OFAC sanctions list";
    case "drainer":
      return "on the known-drainer list";
    case "clear-of-lists":
      return "clear of OFAC + drainer lists";
    case "unrecognised-address":
      return "payee not a recognisable address";
    case "none":
      return "no payee in the challenge";
    default:
      return "not screened";
  }
}

export function segmentPayeeLabel(row: SegmentRow): string {
  return row.payee ?? "no payee";
}
