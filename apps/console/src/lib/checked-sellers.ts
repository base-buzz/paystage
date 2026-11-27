/**
 * The checked-seller probe on `/lists` (#372).
 *
 * This is the same discipline as the Bazaar demand panel (#375) and the list manifest (#363): every date, count and
 * method sentence is rendered from the generated record, never typed in JSX. The record is produced by
 * `scripts/gen-checked-sellers.mjs` from the ops research file `docs/research/checked-sellers.md`, and `--check` fails
 * when the committed copy drifts.
 *
 * The rule this module enforces: a row is shown only when the record dates it and names the method. A host with calls
 * and a "correct" mark but no verification date is not a checked seller — it is an assertion, and it is withheld with a
 * visible count rather than silently dropped.
 *
 * The record carries two fields only as run-level results, not per host: the advertised-price comparison and the payee
 * screening. Those stay `null` in the generated rows and render as "not recorded", because a run aggregate repeated in
 * a row is per-row evidence that does not exist. The page explains that limit rather than filling it in.
 */
import generated from "@/lib/checked-sellers.generated.json";
import { formatCount } from "@/lib/market-demand";

export interface CheckedSellerScreening {
  /** Whether the probed host's payee is in the shipped verified-payee registry. Absent when the record has no payee. */
  onVerifiedPayeeList: boolean;
  verifiedPayeeListGeneratedAt: string;
}

export interface CheckedSellerRow {
  host: string;
  calls30d: number;
  endpointsChecked: number;
  endpointsCorrect: number;
  challengeCorrect: boolean;
  /** Null when the record has no date for the row; the view withholds the row instead of showing it undated. */
  verifiedOn: string | null;
  /** Null when the record has no method for the row; the view withholds it for the same reason. */
  method: string | null;
  /** Null when the record does not record the price comparison per host. */
  priceMatched: boolean | null;
  /** Null when the record does not carry the `payTo` needed to answer the list screen for this row. */
  screening: CheckedSellerScreening | null;
}

export interface CheckedSellersSnapshot {
  verifiedOn: string;
  timeZone: string;
  method: string;
  aggregate: {
    sample: { pages: number; perPage: number; entries: number; catalogueEntries: number };
    rankingField: string;
    topEntries: number;
    callsMax: number;
    callsMin: number;
    probes: {
      getProbes: number;
      postRetries: number;
      endpointRequests: number;
      indexPages: number;
      totalRequests: number;
      requestCap: number;
    };
    result: {
      correct402: number;
      no402: number;
      error: number;
      priceCompared: number;
      priceMatched: number;
      hostsCarryingTopEntries: number;
      topEntries: number;
      mcpNonResponsivePercent: number;
    };
    tail: { path: string; entries: number; sampled: number };
  };
  rowsNamed: number;
  entriesCoveredByName: number;
  /**
   * The method that produced each 402, from the probe's own `method_that_402s` counts (#466): `post` resources
   * answer only to POST, `answered` is the number that answered a 402 on either method, and `postOnlyFirstStatus`
   * counts the HTTP status a GET gets for those POST-only resources. Null when the source run did not record the
   * split; the page then says so rather than inventing a count.
   */
  methodSplit: {
    get: number;
    post: number;
    answered: number;
    postOnlyFirstStatus: Record<string, number>;
  } | null;
  /**
   * The challenge composition (#495), counted per resource from the probe rows: which x402 dialect each answered. `none` are
   * the resources that answered no challenge at all, named with the status each returned. Null when the run did not record it.
   */
  dialectSplit: {
    v2: number;
    legacy: number;
    both: number;
    none: number;
    total: number;
    noChallenge: { host: string; resource: string; status: number | string | null; firstStatus: number | string | null }[];
  } | null;
  /**
   * Both denominators (#499). This census counts **resources**, and one host can carry 29 of the 100, so "7 of 96 exceed 8 KB" is
   * true per resource and **5 of 34** per host. Published together so a reader never has to guess which one a number uses.
   */
  denominators: {
    resources: number;
    hosts: number;
    resourcesOver8kb: number;
    hostsOver8kb: number;
    largestHost: (string | number)[] | null;
  } | null;
  rows: CheckedSellerRow[];
}

/** The committed record, generated from the research file by `scripts/gen-checked-sellers.mjs`. */
export const CHECKED_SELLERS: CheckedSellersSnapshot = generated;

/**
 * The evidence a row must carry. No date or no method means no row: the whole point of this list is that each line can
 * be re-checked, and an undated line cannot.
 */
export function hasVerification(row: CheckedSellerRow): boolean {
  return (
    typeof row.host === "string" &&
    row.host.trim() !== "" &&
    Number.isFinite(row.calls30d) &&
    row.calls30d > 0 &&
    typeof row.verifiedOn === "string" &&
    !Number.isNaN(Date.parse(row.verifiedOn)) &&
    typeof row.method === "string" &&
    row.method.trim() !== ""
  );
}

export interface CheckedSellerView {
  rows: CheckedSellerRow[];
  withheld: number;
}

/** Split the record into rows the page may show and rows it must withhold, so the page can say how many were withheld. */
export function checkedSellerView(snapshot: CheckedSellersSnapshot): CheckedSellerView {
  const rows = snapshot.rows.filter(hasVerification);
  return { rows, withheld: snapshot.rows.length - rows.length };
}

/**
 * The method in one paragraph, assembled from the record's own figures.
 *
 * The last sentence is the honest limit and is not optional: the probe covers the top of the catalogue, where 34 hosts
 * carry all 100 entries, while a separate liveness probe found roughly a quarter of listed MCP servers never answer. A
 * reader who takes this list as a quality ranking has been misled by omission if that sentence is missing.
 */
export function checkedSellersMethod(snapshot: CheckedSellersSnapshot): string {
  const { aggregate } = snapshot;
  const { sample, probes, result } = aggregate;
  return `On ${snapshot.verifiedOn} (${snapshot.timeZone}) a read-only run sampled the Bazaar discovery index — ${formatCount(sample.pages)} pages × ${formatCount(sample.perPage)} entries = ${formatCount(sample.entries)} of the catalogue's ${formatCount(sample.catalogueEntries)} — ranked that sample by ${aggregate.rankingField} and took the top ${formatCount(aggregate.topEntries)} (${formatCount(aggregate.callsMax)} calls down to ${formatCount(aggregate.callsMin)}). Each endpoint got one GET; the ${formatCount(probes.postRetries)} that returned an error status were retried once with POST (${formatCount(probes.totalRequests)} requests in all, inside the ${formatCount(probes.requestCap)} cap). A row counts as a correct challenge only when the reply is a 402 whose payment-required header parses and names a payTo with a numeric amount; a price comparison matched when that amount equalled the price Bazaar advertised. This checks the top of the catalogue, not the market: ${formatCount(result.hostsCarryingTopEntries)} hosts carry all ${formatCount(result.topEntries)} entries, and a separate MCP liveness probe found about ${formatCount(result.mcpNonResponsivePercent)}% of listed MCP servers never answer at all, so it differentiates at the top and says nothing about the tail. **What separates the hosts that carry those entries: nothing we can measure.** A follow-up on 2026-11-23 compared the top quartile against the rest on price, schema, method count and latency and found no separation (price p=0.13; latency +16.5 ms against a 167 ms same-host control spread, p=0.87), so the concentration is real and its cause is not in the metadata.`;
}

/**
 * The method split in one sentence (#466), from the probe's per-resource `method_that_402s` counts.
 *
 * This is the fact a client needs before it follows the list: a GET-only client cannot fetch a resource that only
 * answers POST, so the published count of those resources is part of the table's meaning, not a footnote. Both
 * numbers come from the record; nothing here is typed. A run that did not record the split renders as not recorded.
 */
export function checkedSellersMethodSplit(snapshot: CheckedSellersSnapshot): string {
  const split = snapshot.methodSplit;
  if (
    !split ||
    !Number.isFinite(split.post) ||
    !Number.isFinite(split.answered) ||
    split.answered <= 0 ||
    split.post < 0 ||
    split.post > split.answered
  ) {
    return "The method split for this run was not recorded, so the page does not publish it.";
  }
  const statuses = Object.entries(split.postOnlyFirstStatus ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  const counted = statuses.map(([status, count]) => `${formatCount(count)} with ${status}`);
  const statusPhrase =
    counted.length === 0
      ? ""
      : ` — ${counted.length === 1 ? counted[0] : `${counted.slice(0, -1).join(", ")} and ${counted.at(-1)}`} for a GET`;
  return `${formatCount(split.post)} of ${formatCount(split.answered)} resources answer only on POST${statusPhrase}; either way a GET-only client gets no price.`;
}

/** The run-level summaries above the table; each is built from the record, so a changed record changes the sentence. */
export function checkedSellersSummaries(snapshot: CheckedSellersSnapshot): string[] {
  const { aggregate } = snapshot;
  const { sample, result } = aggregate;
  return [
    `${formatCount(sample.entries)} entries sampled from a ${formatCount(sample.catalogueEntries)}-entry catalogue — and the total moves in both directions: 40,157 on 23 Nov, 40,114 at 17:33Z, 40,111 at 18:02Z, because the index expires entries as well as adding them`,

    `${formatCount(result.correct402)} of ${formatCount(result.topEntries)} endpoints answered a correct 402`,
    `${formatCount(result.priceMatched)} of ${formatCount(result.priceCompared)} price comparisons matched where both prices were known`,
    `${formatCount(result.hostsCarryingTopEntries)} hosts carry all ${formatCount(result.topEntries)} entries`,
  ];
}

/** What the named rows cover, so the table is not read as the whole top 100. */
export function checkedSellersCoverage(snapshot: CheckedSellersSnapshot): string {
  return `The ${formatCount(snapshot.rowsNamed)} hosts named below are the largest the record carries; together they cover ${formatCount(snapshot.entriesCoveredByName)} of the ${formatCount(snapshot.aggregate.topEntries)} probed entries. The other hosts are counted in the concentration figure above but are not named in the record, so they are not shown as rows here.`;
}

/** Why the price and screening cells are empty — stated in terms of the record's own counts. */
export function checkedSellersGap(snapshot: CheckedSellersSnapshot): string {
  const { result } = snapshot.aggregate;
  return `Price match and screening were recorded only as run-level results. The research measured ${formatCount(result.priceMatched)} of ${formatCount(result.priceCompared)} price comparisons as matching where both amounts were known, and states that no row was added to the verified-payee registry (#133) — but it does not carry a per-host price comparison or the payTo each endpoint returned. Those cells therefore say "not recorded" rather than repeating a run-level aggregate as evidence for one host. Adding a host to the registry needs the challenge read with its payee recorded; that is a different act from this probe, and this table does not stride that row.`;
}

/** A withheld row is named by count, never silently removed: the gap is a fact about the record. */
export function withheldRowsNote(withheld: number): string {
  const rows = withheld === 1 ? "row is" : "rows are";
  return `${formatCount(withheld)} ${rows} withheld because the record has no verification date or no method for ${withheld === 1 ? "it" : "them"}. This table never shows a check it cannot date.`;
}

export function formatCheckedCalls(value: number): string {
  return Number.isFinite(value) ? formatCount(value) : "—";
}

export function verifiedLabel(row: CheckedSellerRow): string {
  return row.verifiedOn ?? "undated";
}

export function challengeLabel(row: CheckedSellerRow): string {
  const endpoints = `${formatCount(row.endpointsCorrect)} of ${formatCount(row.endpointsChecked)} endpoint${row.endpointsChecked === 1 ? "" : "s"}`;
  return row.challengeCorrect ? `${endpoints} — correct 402` : `${endpoints} — not all correct`;
}

export function priceMatchLabel(row: CheckedSellerRow): string {
  /** An unrecognised price shape is unknown, not `$0` and not a row to drop: the row stays, the price comparison does not. */
  if (row.priceMatched === null) return "unknown — not recorded per host";
  return row.priceMatched ? "matched the advertisement" : "did not match the advertisement";
}

export function screeningLabel(row: CheckedSellerRow): string {
  if (row.screening === null) return "not recorded per row";
  return row.screening.onVerifiedPayeeList
    ? `on the verified-payee list (${row.screening.verifiedPayeeListGeneratedAt})`
    : `not on the verified-payee list (${row.screening.verifiedPayeeListGeneratedAt})`;
}

/**
 * The challenge composition (#495): measured, and published nowhere until now.
 *
 * The page said how many resources answer **only on POST**; it never said which x402 dialect they speak, so a reader could not tell
 * whether the ecosystem had settled on v2 or was split. The 2026-11-27 run settles it for this sample: **96 v2, 0 legacy, 4 none** —
 * and an earlier six-seller observation that "sellers are split across dialects" is now one data point against 96.
 *
 * The four that answered no challenge are named with the status each returned, because "4 did not" without names is a number a
 * reader cannot check and cannot chase.
 */
export function checkedSellersDialects(snapshot: CheckedSellersSnapshot): string {
  const split = snapshot.dialectSplit;
  if (!split || !Number.isFinite(split.total) || split.total <= 0) {
    return "The challenge dialects for this run were not recorded, so the page does not publish them.";
  }
  const named = split.noChallenge
    .map((row) => `${row.host} (${row.status ?? "no status"})`)
    .join(", ");
  const legacy = split.legacy === 0 ? "none used the legacy header" : `${formatCount(split.legacy)} used the legacy header`;
  return (
    `${formatCount(split.v2)} of ${formatCount(split.total)} resources answered a v2 challenge, ${legacy}` +
    (split.both > 0 ? `, ${formatCount(split.both)} answered both` : "") +
    (split.none > 0 ? `, and ${formatCount(split.none)} answered none at all: ${named}.` : ".")
  );
}

/**
 * The two denominators (#499), in one sentence, because every headline on this page counts resources and a reader reads them as
 * services. **`agent.pocket.network` alone carries 29 of the 100 resources**, so "7 of 96 exceed 8 KB" is also "5 of 34 hosts" —
 * the same fact, two very different impressions.
 */
export function checkedSellersDenominators(snapshot: CheckedSellersSnapshot): string {
  const d = snapshot.denominators;
  if (!d || !Number.isFinite(d.resources) || !Number.isFinite(d.hosts) || d.hosts <= 0) {
    return "The host count for this run was not recorded, so the page publishes resource counts only.";
  }
  const carrier = d.largestHost
    ? ` — ${String(d.largestHost[0])} alone carries ${formatCount(Number(d.largestHost[1]))} of them`
    : "";
  return (
    `${formatCount(d.resources)} resources across ${formatCount(d.hosts)} hosts${carrier}. ` +
    `Every count on this page is per **resource**, not per host: the ${formatCount(d.resourcesOver8kb)} challenges over 8 KB ` +
    `belong to ${formatCount(d.hostsOver8kb)} of those hosts.`
  );
}
