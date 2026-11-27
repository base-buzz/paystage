#!/usr/bin/env node
/**
 * Copy the checked-seller verification rows the `/lists` page renders (#372).
 *
 * The verification record is produced by `ops/bin/checked-sellers-probe.mjs` (#392): one GET per ranked endpoint,
 * judged by `isCorrectChallenge`, written as JSON. The probe's JSON is the primary source; this script renders the
 * page fields from it and never regexes a rendered sentence back out of markdown.
 *
 * The old `docs/research/checked-sellers.md` parser stays for **one release** as a fallback. When the JSON is absent
 * it prints a loud error and renders from the markdown record, so a missing file cannot silently produce an empty
 * page. When neither source is mounted the script exits 2.
 *
 * The guard this row exists for (#387): a checked seller without a date and a method is an assertion with no way to
 * check it. So the script refuses to emit any row when the aggregate has lost a published number, when the run has no
 * verification date or method, or when a host row is malformed. It refuses rather than writing a record that silently
 * drops a figure the page used to carry.
 *
 *   node scripts/gen-checked-sellers.mjs          # write
 *   node scripts/gen-checked-sellers.mjs --check  # exit 1 when out of date, 2 when no source is mounted
 *
 * `PAYSTAGE_CHECKED_SELLERS_JSON` overrides the probe JSON, `PAYSTAGE_CHECKED_SELLERS` overrides the markdown fallback
 * (or points at a .json file), and `PAYSTAGE_CHECKED_SELLERS_OUT` overrides the output. An explicit
 * `PAYSTAGE_CHECKED_SELLERS` is authoritative, which is how the tests drive a markdown fixture without picking up a
 * mounted probe file.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_JSON = "/work/ops/docs/state/checked-sellers-probe.json";
const DEFAULT_MARKDOWN = "/work/ops/docs/research/checked-sellers.md";
const OUT =
  process.env.PAYSTAGE_CHECKED_SELLERS_OUT ?? join(ROOT, "apps/console/src/lib/checked-sellers.generated.json");

const explicit = process.env.PAYSTAGE_CHECKED_SELLERS;
const explicitMarkdown = explicit && !explicit.endsWith(".json") ? explicit : undefined;
const explicitJson =
  process.env.PAYSTAGE_CHECKED_SELLERS_JSON ?? (explicit?.endsWith(".json") ? explicit : undefined);
/** An explicit markdown source is authoritative (the tests rely on it); only the default path prefers JSON. */
const JSON_SOURCE = explicitMarkdown ? undefined : (explicitJson ?? DEFAULT_JSON);
const MARKDOWN_SOURCE = explicitMarkdown ?? DEFAULT_MARKDOWN;

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const number = (value) => Number(String(value).replace(/,/g, ""));

/** Refuse a snapshot that lost an aggregate figure the page publishes (#387): derive it or stop. */
const REQUIRED_RESULT = {
  correct402: "correct-402 count",
  no402: "no-402 count",
  error: "error count",
  priceCompared: "price-comparison denominator",
  priceMatched: "price-matched count",
  hostsCarryingTopEntries: "host concentration",
  topEntries: "top-entry count",
  mcpNonResponsivePercent: "MCP liveness figure",
};

function assertComplete(snapshot, origin) {
  for (const [key, label] of Object.entries(REQUIRED_RESULT)) {
    const value = snapshot.aggregate?.result?.[key];
    if (!Number.isFinite(value)) {
      fail(
        1,
        `checked-sellers: ${origin} no longer carries the ${label} — the aggregate would lose a published number, so this refuses instead of writing it`,
      );
    }
  }
  for (const [key, label] of Object.entries({
    pages: "sample page count",
    perPage: "sample page size",
    entries: "sample entry count",
    catalogueEntries: "catalogue total",
  })) {
    if (!Number.isFinite(snapshot.aggregate?.sample?.[key])) {
      fail(1, `checked-sellers: ${origin} no longer carries the ${label} — refusing to emit an aggregate the page cannot evidence`);
    }
  }
  for (const [key, label] of Object.entries({
    getProbes: "GET-probe count",
    postRetries: "POST-retry count",
    endpointRequests: "endpoint-request count",
    indexPages: "index-page count",
    totalRequests: "total-request count",
    requestCap: "request cap",
  })) {
    if (!Number.isFinite(snapshot.aggregate?.probes?.[key])) {
      fail(1, `checked-sellers: ${origin} no longer carries the ${label} — refusing to emit rows with no method`);
    }
  }
  if (typeof snapshot.aggregate?.rankingField !== "string" || snapshot.aggregate.rankingField === "") {
    fail(1, `checked-sellers: ${origin} no longer names the ranking field — refusing to emit an undated method`);
  }
  if (!Number.isFinite(snapshot.aggregate?.tail?.entries) || !Number.isFinite(snapshot.aggregate?.tail?.sampled)) {
    fail(1, `checked-sellers: ${origin} no longer carries the tail sample — refusing to emit an aggregate the page cannot evidence`);
  }
  if (typeof snapshot.verifiedOn !== "string" || Number.isNaN(Date.parse(snapshot.verifiedOn))) {
    fail(1, `checked-sellers: ${origin} has no readable verification date — refusing to emit a row the page cannot date`);
  }
  if (typeof snapshot.method !== "string" || snapshot.method.trim() === "") {
    fail(1, `checked-sellers: ${origin} names no method — refusing to emit rows with no method`);
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length === 0) {
    fail(1, `checked-sellers: ${origin} has no parsable host rows — refusing to emit an empty table`);
  }
  for (const row of snapshot.rows) {
    if (
      typeof row.host !== "string" ||
      row.host.trim() === "" ||
      !Number.isFinite(row.calls30d) ||
      row.calls30d <= 0 ||
      !Number.isFinite(row.endpointsChecked) ||
      row.endpointsChecked <= 0 ||
      !Number.isFinite(row.endpointsCorrect) ||
      row.endpointsCorrect < 0 ||
      row.endpointsCorrect > row.endpointsChecked
    ) {
      fail(1, `checked-sellers: malformed row for "${row.host}" — a host needs a name, a positive call count and a correct/checked ratio`);
    }
  }
}

function finalize(snapshot) {
  const rows = snapshot.rows.map((row) => ({
    host: row.host,
    calls30d: row.calls30d,
    endpointsChecked: row.endpointsChecked,
    endpointsCorrect: row.endpointsCorrect,
    challengeCorrect: row.endpointsCorrect === row.endpointsChecked,
    verifiedOn: snapshot.verifiedOn,
    method: snapshot.method,
    /** Not carried per host by the probe. The page prints "not recorded"; it never repeats the run aggregate as a row. */
    priceMatched: null,
    /** No payTo per row in the probe record, so it cannot answer "is the payee on our lists". */
    screening: null,
  }));
  return {
    verifiedOn: snapshot.verifiedOn,
    timeZone: snapshot.timeZone,
    method: snapshot.method,
    aggregate: snapshot.aggregate,
    /** The published method split (#466), derived from the probe's own per-resource method counts. Null when the
     * source run did not record it, in which case the page says it is not recorded rather than inventing a count. */
    methodSplit: snapshot.methodSplit ?? null,
    rowsNamed: rows.length,
    entriesCoveredByName: rows.reduce((total, row) => total + row.endpointsChecked, 0),
    rows,
  };
}

/* ---------------------------------------------------------------------------------------------------------------
 * Primary source: the probe's JSON.
 * ------------------------------------------------------------------------------------------------------------- */

function fromProbeJson(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(1, `checked-sellers: ${path} is not readable JSON (${error instanceof Error ? error.message : String(error)})`);
  }

  const hosts = Array.isArray(data.hosts) ? data.hosts : [];
  const named = Number(data.rowsNamed ?? hosts.length);
  if (!Number.isFinite(named) || named <= 0 || named > hosts.length) {
    fail(1, `checked-sellers: ${path} has rowsNamed=${data.rowsNamed} but ${hosts.length} host rows — refusing to invent a table size`);
  }

  const methodThat402s = data.aggregate?.result?.dialect?.methodThat402s ?? null;
  /** The GET status a POST-only resource answers, counted from the probe's own per-resource firstStatus (#466). */
  const postOnlyFirstStatus = {};
  for (const row of Array.isArray(data.rows) ? data.rows : []) {
    if (row?.status === 402 && row?.method === "POST" && row?.firstStatus != null) {
      const status = String(row.firstStatus);
      postOnlyFirstStatus[status] = (postOnlyFirstStatus[status] ?? 0) + 1;
    }
  }
  const methodSplit =
    methodThat402s && Number.isFinite(methodThat402s.GET) && Number.isFinite(methodThat402s.POST)
      ? {
          get: methodThat402s.GET,
          post: methodThat402s.POST,
          answered: methodThat402s.GET + methodThat402s.POST,
          postOnlyFirstStatus,
        }
      : null;
  if (
    methodSplit &&
    Object.values(methodSplit.postOnlyFirstStatus).reduce((total, n) => total + n, 0) !== methodSplit.post
  ) {
    fail(
      1,
      `checked-sellers: ${path} records ${methodSplit.post} POST-only resources but the firstStatus counts do not add up to that — refusing to publish a status split that disagrees with the method count`,
    );
  }
  if (methodSplit && methodSplit.answered !== data.aggregate?.result?.correct402) {
    fail(
      1,
      `checked-sellers: ${path} says ${methodSplit.answered} resources answered a 402 by GET or POST but ${data.aggregate?.result?.correct402} correct — refusing to publish a method split that disagrees with the count`,
    );
  }

  const snapshot = {
    verifiedOn: data.verifiedOn,
    timeZone: data.timeZone ?? "UTC",
    method: data.method,
    aggregate: {
      sample: data.aggregate?.sample,
      rankingField: data.aggregate?.rankingField,
      topEntries: data.aggregate?.topEntries,
      callsMax: data.aggregate?.callsMax,
      callsMin: data.aggregate?.callsMin,
      probes: data.aggregate?.probes,
      result: {
        correct402: data.aggregate?.result?.correct402,
        no402: data.aggregate?.result?.no402,
        error: data.aggregate?.result?.error,
        priceCompared: data.aggregate?.result?.priceCompared,
        priceMatched: data.aggregate?.result?.priceMatched,
        hostsCarryingTopEntries: data.aggregate?.result?.hostsCarryingTopEntries,
        topEntries: data.aggregate?.result?.topEntries,
        mcpNonResponsivePercent: data.aggregate?.result?.mcpNonResponsivePercent,
      },
      tail: data.aggregate?.tail,
    },
    methodSplit,
    rows: [...hosts]
      .sort((left, right) => right.calls30d - left.calls30d || left.host.localeCompare(right.host))
      .slice(0, named),
  };
  assertComplete(snapshot, path);
  return finalize(snapshot);
}

/* ---------------------------------------------------------------------------------------------------------------
 * Fallback for one release: the markdown research record. Kept verbatim so the page does not change while the probe
 * JSON is absent; it prints an error first, because a missing JSON is a deployment fault, not a normal mode.
 * ------------------------------------------------------------------------------------------------------------- */

function fromMarkdown(source, path) {
  /** Read one value out of the record, or stop: a page figure is never typed in JSX, so a parse miss is a hard failure. */
  function field(pattern, label) {
    const match = pattern.exec(source);
    if (match === null) {
      fail(1, `checked-sellers: the verification record has no ${label} — refusing to emit a row the page cannot evidence`);
    }
    return match;
  }

  /**
   * The verification date and method are per-run facts, and every emitted row carries both. The date is the run date
   * the record states; the method is the procedure the record describes (one GET per endpoint, one POST retry on an
   * error status). Without either, no row is emitted — that is the whole point of this list.
   */
  const runLine = field(
    /Verification run,\s*(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]+)\))?/,
    'verification date ("Verification run, YYYY-MM-DD")',
  );
  const verifiedOn = runLine[1];
  const timeZone = runLine[2] ?? "UTC";
  if (Number.isNaN(Date.parse(verifiedOn))) {
    fail(1, `checked-sellers: the verification date ${verifiedOn} is not a readable date`);
  }

  const method = "GET, one POST retry on error status";
  if (!/GET probes; the \d+ that returned an error status were retried once with \*\*POST\*\*/.test(source)) {
    fail(1, "checked-sellers: the verification record no longer describes the GET probe and its POST retry — refusing to emit rows with no method");
  }

  const sample = field(
    /Sampled the Bazaar discovery index: \*\*(\d+) pages × (\d+) = ([\d,]+) entries\*\* \(the catalogue is ([\d,]+)/,
    "sample line (pages × entries, catalogue size)",
  );
  const ranked = field(
    /Ranked those [\d,]+ by `([^`]+)` and took the \*\*top (\d+)\*\* \(range: ([\d,]+) calls down to\s*([\d,]+) calls\)/,
    "ranking line (field, top N, call range)",
  );
  const probes = field(
    /(\d+) GET probes; the (\d+) that returned an error status were retried once with \*\*POST\*\*\s*—\s*(\d+) endpoint requests\s*plus (\d+)\s+index pages = \*\*(\d+) requests total\*\*, inside the (\d+) cap/,
    "probe counts and request cap",
  );
  const correct = field(/correct 402[^|]*\|\s*\*\*(\d+)\*\*/, "correct-402 count");
  const no402 = field(/no 402 at all\s*\|\s*(\d+)\s*\|/, "no-402 count");
  const errored = field(/error \/ unreachable after both methods\s*\|\s*(\d+)\s*\|/, "error count");
  const price = field(/price matched the advertisement[^|]*\|\s*\*\*(\d+) \/ (\d+)\*\*/, "price-comparison counts");
  const hosts = field(/\*\*(\d+) distinct hosts\*\* carry the top (\d+) entries/, "host concentration line");
  const mcp = field(/MCP liveness probe already found\s*~(\d+)% of listed MCP servers do not answer at all/, "MCP liveness figure");
  const tail = field(/dominated by `([^`]+)` paths \((\d+) of ([\d,]+) sampled\)/, "tail path sample");

  /**
   * The table names the largest hosts in the record, not every endpoint. Parse the rows between the section heading
   * and the next one, and stop on a row that is not `host | correct/total | calls` rather than silently dropping it.
   */
  const section = field(/## What the top of the market actually is([\s\S]*?)(?=\n## |$)/, "top-of-market table section")[1];
  const rows = [...section.matchAll(/^\|\s*([^|\n]+?)\s*\|\s*(\d+)\/(\d+)\s*\|\s*([\d,]+)\s*\|\s*$/gm)].map((match) => {
    const host = match[1].trim();
    const endpointsCorrect = Number(match[2]);
    const endpointsChecked = Number(match[3]);
    const calls30d = number(match[4]);
    if (host === "" || !Number.isFinite(calls30d) || calls30d <= 0 || endpointsChecked <= 0) {
      fail(1, `checked-sellers: malformed row for "${host}" — a host needs a name, a positive call count and at least one endpoint`);
    }
    if (endpointsCorrect > endpointsChecked) {
      fail(1, `checked-sellers: row "${host}" says ${endpointsCorrect}/${endpointsChecked} correct, which is not a ratio — refusing to copy it`);
    }
    return { host, calls30d, endpointsChecked, endpointsCorrect };
  });

  if (rows.length === 0) {
    fail(1, "checked-sellers: the top-of-market table has no parsable host rows");
  }

  const snapshot = {
    verifiedOn,
    timeZone,
    method,
    aggregate: {
      sample: {
        pages: number(sample[1]),
        perPage: number(sample[2]),
        entries: number(sample[3]),
        catalogueEntries: number(sample[4]),
      },
      rankingField: ranked[1],
      topEntries: number(ranked[2]),
      callsMax: number(ranked[3]),
      callsMin: number(ranked[4]),
      probes: {
        getProbes: number(probes[1]),
        postRetries: number(probes[2]),
        endpointRequests: number(probes[3]),
        indexPages: number(probes[4]),
        totalRequests: number(probes[5]),
        requestCap: number(probes[6]),
      },
      result: {
        correct402: number(correct[1]),
        no402: number(no402[1]),
        error: number(errored[1]),
        priceCompared: number(price[1]),
        priceMatched: number(price[2]),
        hostsCarryingTopEntries: number(hosts[1]),
        topEntries: number(hosts[2]),
        mcpNonResponsivePercent: number(mcp[1]),
      },
      tail: { path: tail[1], entries: number(tail[2]), sampled: number(tail[3]) },
    },
    rows,
  };
  assertComplete(snapshot, path);
  return finalize(snapshot);
}

/* ---------------------------------------------------------------------------------------------------------------
 * Source selection. JSON is primary; markdown is a loud one-release fallback; neither is exit 2.
 * ------------------------------------------------------------------------------------------------------------- */

let output;
if (JSON_SOURCE && existsSync(JSON_SOURCE)) {
  output = fromProbeJson(JSON_SOURCE);
} else if (existsSync(MARKDOWN_SOURCE)) {
  console.error(
    `checked-sellers: ERROR: no probe JSON at ${JSON_SOURCE ?? "(explicit markdown source)"}; falling back to the markdown research record ${MARKDOWN_SOURCE} for one release. Run ops/bin/checked-sellers-probe.mjs and promote its JSON — a missing JSON must not silently produce a page.`,
  );
  output = fromMarkdown(readFileSync(MARKDOWN_SOURCE, "utf8"), MARKDOWN_SOURCE);
} else {
  fail(
    2,
    `checked-sellers: no verification record — no probe JSON at ${JSON_SOURCE ?? "(explicit markdown source)"} and no research record at ${MARKDOWN_SOURCE}; cannot verify or refresh the page copy`,
  );
}

const body = `${JSON.stringify(output, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== body) {
    fail(1, "checked-sellers: apps/console/src/lib/checked-sellers.generated.json is out of date — run node scripts/gen-checked-sellers.mjs");
  }
  console.log(`checked-sellers: current (method: ${output.method})`);
  process.exit(0);
}

writeFileSync(OUT, body);
console.log(
  `checked-sellers: wrote ${OUT} — ${output.rows.length} named host(s), ${output.entriesCoveredByName} of ${output.aggregate.topEntries} entries, verified ${output.verifiedOn}, method: ${output.method}`,
);
