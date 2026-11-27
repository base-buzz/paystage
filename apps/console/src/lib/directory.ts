/**
 * The public x402 merchant directory (#497).
 *
 * Everything on `/directory` and `/directory.json` comes from `directory.generated.json`, written by
 * `ops/bin/directory-build.mjs` from the checked-seller census and x402scan's recipient snapshot. The page and the
 * agent endpoint both call into this module, so there is one list, not two that are supposed to match.
 *
 * The rules this module enforces, and the page repeats in prose:
 *
 *  - a listing means the host answered a payment challenge when we asked, not that anybody paid it;
 *  - demand is only shown where x402scan published it for the row's `payTo`, with the explorer named and dated; a
 *    row with no match says `not known`, never `0`;
 *  - rows are ordered by observed price, cheapest first, and that order is not a ranking of quality.
 */
import generated from "@/lib/directory.generated.json";

export interface X402scanDemand {
  recipient: string;
  url: string;
  payments: number;
  valueUsd: number;
  source: "x402scan";
  capturedOn: string;
}

export interface DirectoryRow {
  host: string;
  resource: string;
  category: string;
  categoryBasis: "path" | "listing-description" | "default";
  priceUsd: number;
  priceUnit: "request";
  method: string;
  chain: string;
  chains: string[];
  challengeBytes: number;
  firstVerifiedOn: string;
  lastVerifiedOn: string;
  verifiedSource: string;
  payTo: string;
  x402scan: X402scanDemand | null;
}

export interface DirectoryTaxonomyEntry {
  id: string;
  label: string;
  definition: string;
  count: number;
}

export interface DirectorySnapshot {
  schema: string;
  $schema: string;
  generatedAt: string | null;
  verifiedOn: string | null;
  firstVerifiedOn: string | null;
  source: {
    census: {
      name: string;
      verifiedOn: string | null;
      generatedAt: string | null;
      method: string | null;
      predicate: string | null;
    };
    history: { name: string; verifiedOn: string | null }[];
    demand: {
      source: "x402scan";
      url: string;
      capturedOn: string;
      level: "recipient";
      note: string;
    } | null;
  };
  ordering: { by: string; direction: string; tieBreak: string; reason: string };
  taxonomy: DirectoryTaxonomyEntry[];
  counts: {
    resources: number;
    hosts: number;
    censusRows: number;
    notAnswered: number;
    byCategory: Record<string, number>;
    withDemand: number;
    withoutDemand: number;
  };
  rows: DirectoryRow[];
}

/** The committed snapshot. Regenerate with `node /work/ops/bin/directory-build.mjs`, never by editing this file. */
export const DIRECTORY: DirectorySnapshot = generated as DirectorySnapshot;

/**
 * A row is shown only when it can be dated and traced. This is defense in depth: the generator already refuses to
 * write an undated row, and the check fails if one appears. A missing row is counted on the page, not silently lost.
 */
export function hasEvidence(row: DirectoryRow): boolean {
  return (
    typeof row.host === "string" &&
    row.host.trim() !== "" &&
    typeof row.resource === "string" &&
    /^https:\/\//.test(row.resource) &&
    Number.isFinite(row.priceUsd) &&
    row.priceUsd >= 0 &&
    typeof row.firstVerifiedOn === "string" &&
    !Number.isNaN(Date.parse(row.firstVerifiedOn)) &&
    typeof row.lastVerifiedOn === "string" &&
    !Number.isNaN(Date.parse(row.lastVerifiedOn)) &&
    typeof row.verifiedSource === "string" &&
    row.verifiedSource.trim() !== "" &&
    Number.isFinite(row.challengeBytes) &&
    row.challengeBytes > 0
  );
}

export interface DirectoryView {
  rows: DirectoryRow[];
  withheld: number;
  byCategory: DirectoryTaxonomyEntry[];
}

/** The page's rows and its category counts, derived from the same snapshot the JSON endpoint serves. */
export function directoryView(snapshot: DirectorySnapshot = DIRECTORY): DirectoryView {
  const rows = snapshot.rows.filter(hasEvidence);
  const byCategory = snapshot.taxonomy.map((entry) => ({
    ...entry,
    count: rows.filter((row) => row.category === entry.id).length,
  }));
  return { rows, withheld: snapshot.rows.length - rows.length, byCategory };
}

/** The exact object `/directory.json` serves. The page reads `DIRECTORY`; the test asserts both carry the same rows. */
export function directoryPayload(snapshot: DirectorySnapshot = DIRECTORY): DirectorySnapshot {
  return snapshot;
}

export function categoryLabel(snapshot: DirectorySnapshot, id: string): string {
  return snapshot.taxonomy.find((entry) => entry.id === id)?.label ?? id;
}

const PRESENT = new Intl.NumberFormat("en-US");

/** Dollars, four decimals — the census prices span $0.001–$0.20 and rounding to cents would erase the low end. */
export function formatPrice(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function formatBytes(value: number): string {
  return `${PRESENT.format(value)} B`;
}

export function formatPayments(value: number): string {
  return `${PRESENT.format(value)} payments`;
}

/** The value the explorer publishes is micro-USDC; render it as USD without implying we measured it. */
export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The demand cell: explorer figures with their source and date, or the honest unknown. Never zero. */
export function demandLabel(demand: X402scanDemand | null): string {
  if (demand === null) return "not known";
  return `${formatPayments(demand.payments)} · ${formatUsd(demand.valueUsd)}`;
}

/** A path for the table's second line; the full resource is the link. */
export function resourcePath(resource: string): string {
  try {
    const url = new URL(resource);
    return `${url.pathname}${url.search}`;
  } catch {
    return resource;
  }
}

/** One sentence the page must carry verbatim — the difference between a listing and a payment. */
export const LISTING_MEANING =
  "A listing means this host answered a payment challenge when we asked — not that anybody paid it.";

/** Why this order, stated once so the table is not read as a leaderboard. */
export const ORDER_EXPLANATION =
  "Rows are ordered by the price the 402 quoted, cheapest first, then by host. Price is the only field comparable across unlike services; the order is not a ranking of quality, and no one paid to be listed.";

/** What the census covers, and what it does not. */
export function coverageSentence(snapshot: DirectorySnapshot = DIRECTORY): string {
  const { counts } = snapshot;
  return `${counts.resources} resources across ${counts.hosts} hosts answered a correct x402 v2 challenge in the census; the ${counts.notAnswered} endpoints that did not return a correct challenge are not listed.`;
}
