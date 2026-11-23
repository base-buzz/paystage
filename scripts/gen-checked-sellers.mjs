#!/usr/bin/env node
/**
 * Copy the checked-seller verification rows the `/lists` page renders (#372).
 *
 * The verification record lives on the ops volume (`docs/research/checked-sellers.md`), which the console cannot read at
 * build or request time. This script reads that record and emits the rows plus the run-level method and aggregates into
 * `apps/console/src/lib/checked-sellers.generated.json`, so the page is a static read and any drift is a diff in git —
 * the same shape as `gen-bazaar-demand.mjs` and `gen-lists-manifest.mjs`.
 *
 * The guard this row exists for: a checked seller without a date and a method is an assertion with no way to check it.
 * So the script refuses to emit any row when the record has lost its verification date or its method paragraph, and it
 * refuses a malformed row rather than copying a host with no call count.
 *
 * What the record does not carry — a per-host price comparison and the payee each endpoint returned — is written as
 * `null`, not filled in from the run-level aggregate. The page prints "not recorded" beside those cells; an aggregate
 * repeated per row would be per-row evidence that does not exist.
 *
 *   node scripts/gen-checked-sellers.mjs          # write
 *   node scripts/gen-checked-sellers.mjs --check  # exit 1 when out of date, 2 when the source is not mounted
 *
 * `PAYSTAGE_CHECKED_SELLERS` and `PAYSTAGE_CHECKED_SELLERS_OUT` override the paths, so the tests can drive a fixture.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.env.PAYSTAGE_CHECKED_SELLERS ?? "/work/ops/docs/research/checked-sellers.md";
const OUT =
  process.env.PAYSTAGE_CHECKED_SELLERS_OUT ?? join(ROOT, "apps/console/src/lib/checked-sellers.generated.json");

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

if (!existsSync(SOURCE)) {
  fail(
    2,
    `checked-sellers: no verification record at ${SOURCE} — cannot verify or refresh the page copy; set PAYSTAGE_CHECKED_SELLERS to the research file`,
  );
}

const source = readFileSync(SOURCE, "utf8");

/** Read one value out of the record, or stop: a page figure is never typed in JSX, so a parse miss is a hard failure. */
function field(pattern, label) {
  const match = pattern.exec(source);
  if (match === null) {
    fail(1, `checked-sellers: the verification record has no ${label} — refusing to emit a row the page cannot evidence`);
  }
  return match;
}

const number = (value) => Number(String(value).replace(/,/g, ""));

/**
 * The verification date and method are per-run facts, and every emitted row carries both. The date is the run date the
 * record states; the method is the procedure the record describes (one GET per endpoint, one POST retry on an error
 * status). Without either, no row is emitted — that is the whole point of this list.
 */
const runLine = field(/Verification run,\s*(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]+)\))?/, "verification date (\"Verification run, YYYY-MM-DD\")");
const verifiedOn = runLine[1];
const timeZone = runLine[2] ?? "UTC";
if (Number.isNaN(Date.parse(verifiedOn))) {
  fail(1, `checked-sellers: the verification date ${verifiedOn} is not a readable date`);
}

const methodField = "GET probe, POST retry once on an error status";
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
 * The table names the largest hosts in the record, not every endpoint. Parse the rows between the section heading and
 * the next one, and stop on a row that is not `host | correct/total | calls` rather than silently dropping it: a
 * half-parsed row is exactly the kind of unverifiable listing this page exists to prevent.
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
  return {
    host,
    calls30d,
    endpointsChecked,
    endpointsCorrect,
    challengeCorrect: endpointsCorrect === endpointsChecked,
    verifiedOn,
    method: methodField,
    /** Not in the record per host. The page prints "not recorded"; it never repeats the 74/74 run aggregate as a row. */
    priceMatched: null,
    /** Not in the record per row: the record carries no payTo, so it cannot answer "is the payee on our lists". */
    screening: null,
  };
});

/**
 * Fail loudly when the record stops carrying the aggregate.
 *
 * 2026-11-23: after the research record was corrected (34 → 33 hosts) and re-worded, this generator wrote a record with **no aggregate block** — no host count, no
 * correct-402 count, no price comparison — while `--check` still reported the committed file as merely "out of date". Regenerating would have removed numbers from the
 * published page, which is worse than a build failure. #387's rule: derive it or refuse, never silently drop it.
 */
for (const [name, value] of Object.entries({
  "correct-402 count": correct,
  "price-comparison counts": price,
  "host concentration": hosts,
})) {
  if (value === null) {
    fail(1, `checked-sellers: the record no longer carries the ${name} — the aggregate would lose a published number, so this refuses instead of writing it`);
  }
}

if (rows.length === 0) {
  fail(1, "checked-sellers: the top-of-market table has no parsable host rows");
}

const checkedCovered = rows.reduce((total, row) => total + row.endpointsChecked, 0);

const body = `${JSON.stringify(
  {
    verifiedOn,
    timeZone,
    method: methodField,
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
    rowsNamed: rows.length,
    entriesCoveredByName: checkedCovered,
    rows,
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== body) {
    fail(1, "checked-sellers: apps/console/src/lib/checked-sellers.generated.json is out of date — run node scripts/gen-checked-sellers.mjs");
  }
  console.log("checked-sellers: current");
  process.exit(0);
}

writeFileSync(OUT, body);
console.log(
  `checked-sellers: wrote ${OUT} — ${rows.length} named host(s), ${checkedCovered} of ${number(ranked[2])} entries, verified ${verifiedOn}`,
);
