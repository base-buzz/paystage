#!/usr/bin/env node
/**
 * Render the "uncensored-inference" class segment on `/lists` from its measurement record.
 *
 * The segment is not prose about the class: it is 55 rows, each with a verdict and a date. The record is assembled by
 * `ops/bin/checked-sellers-segment.mjs` from the re-run keyword sweep, the documented one-GET/one-POST-retry probe
 * (`checked-sellers-probe.mjs`) and the shared payee-screening module. This script copies the pieces the page renders
 * and refuses to write a row that has lost its verdict, its date or its method — the same rule as the top-of-catalogue
 * list (#372/#392).
 *
 *   node scripts/gen-checked-sellers-segment.mjs          # write
 *   node scripts/gen-checked-sellers-segment.mjs --check  # exit 1 when out of date, 2 when the record is not mounted
 *
 * `PAYSTAGE_CHECKED_SELLERS_SEGMENT` overrides the input, `PAYSTAGE_CHECKED_SELLERS_SEGMENT_OUT` the output.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.env.PAYSTAGE_CHECKED_SELLERS_SEGMENT ?? "/work/ops/docs/state/checked-sellers-segment.json";
const OUT =
  process.env.PAYSTAGE_CHECKED_SELLERS_SEGMENT_OUT ??
  join(ROOT, "apps/console/src/lib/checked-sellers-segment.generated.json");

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

if (!existsSync(SOURCE)) {
  fail(
    2,
    `checked-sellers-segment: no measurement record at ${SOURCE} — run ops/bin/uncensored-inference-sweep.mjs, ops/bin/checked-sellers-probe.mjs and ops/bin/checked-sellers-segment.mjs first`,
  );
}

let data;
try {
  data = JSON.parse(readFileSync(SOURCE, "utf8"));
} catch (error) {
  fail(1, `checked-sellers-segment: ${SOURCE} is not readable JSON (${error instanceof Error ? error.message : String(error)})`);
}

const REQUIRED_RESULT = [
  "correct402",
  "no402",
  "error",
  "priceCompared",
  "priceMatched",
  "screenedClear",
  "screenedFlagged",
  "screenedNone",
];
for (const key of REQUIRED_RESULT) {
  if (!Number.isFinite(data.result?.[key])) {
    fail(1, `checked-sellers-segment: the record has no numeric result.${key} — refusing to emit a segment that lost a published number`);
  }
}
for (const key of ["hosts", "endpoints", "matchedEntries", "catalogueEntries"]) {
  if (!Number.isFinite(data.denominator?.[key]) || data.denominator[key] <= 0) {
    fail(1, `checked-sellers-segment: the record has no positive denominator.${key} — the page needs its denominator`);
  }
}
if (typeof data.measuredOn !== "string" || Number.isNaN(Date.parse(data.measuredOn))) {
  fail(1, "checked-sellers-segment: the record has no readable measurement date — refusing to emit undated rows");
}
if (typeof data.method !== "string" || data.method.trim() === "") {
  fail(1, "checked-sellers-segment: the record names no probe method — refusing to emit rows with no method");
}
if (typeof data.classDefinition?.basis !== "string" || data.classDefinition.basis.trim() === "") {
  fail(1, "checked-sellers-segment: the record does not say how class membership was determined — refusing to publish the segment");
}
if (!Array.isArray(data.rows) || data.rows.length === 0) {
  fail(1, "checked-sellers-segment: the record has no rows — refusing to emit an empty segment");
}
if (data.rows.length !== data.denominator.hosts) {
  fail(
    1,
    `checked-sellers-segment: ${data.rows.length} rows for a denominator of ${data.denominator.hosts} hosts — a partial segment is not the 55-host answer`,
  );
}
for (const row of data.rows) {
  if (typeof row.host !== "string" || row.host.trim() === "") {
    fail(1, "checked-sellers-segment: a row has no host — refusing to emit an anonymous check");
  }
  if (typeof row.verifiedOn !== "string" || Number.isNaN(Date.parse(row.verifiedOn))) {
    fail(1, `checked-sellers-segment: ${row.host} has no readable verdict date — refusing to emit an undated row`);
  }
  if (typeof row.method !== "string" || row.method.trim() === "") {
    fail(1, `checked-sellers-segment: ${row.host} names no probe method — refusing to emit a row with no method`);
  }
  if (typeof row.correct402 !== "boolean") {
    fail(1, `checked-sellers-segment: ${row.host} has no boolean 402 verdict — 55/55 verdicts is the done-when`);
  }
  if (typeof row.screening !== "string" || row.screening.trim() === "") {
    fail(1, `checked-sellers-segment: ${row.host} has no screening verdict — the segment must say whether the payee screens`);
  }
}

const body = {
  segment: data.segment,
  title: data.title,
  measuredOn: data.measuredOn,
  timeZone: data.timeZone ?? "UTC",
  method: data.method,
  predicate: data.predicate,
  classDefinition: data.classDefinition,
  choiceRule: data.choiceRule,
  denominator: data.denominator,
  budget: data.budget,
  result: data.result,
  killCriterion: data.killCriterion,
  rows: data.rows.map((row) => ({
    host: row.host,
    calls30d: row.calls30d,
    endpoint: row.endpoint,
    entriesMatched: row.entriesMatched,
    verifiedOn: row.verifiedOn,
    method: row.method,
    advertisedPriceUsd: row.advertisedPriceUsd,
    askedPriceUsd: row.askedPriceUsd,
    payee: row.payee,
    screening: row.screening,
    correct402: row.correct402,
    priceCompared: row.priceCompared,
    priceMatched: row.priceMatched,
    status: row.status,
    reason: row.reason,
  })),
};

const text = `${JSON.stringify(body, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== text) {
    fail(
      1,
      "checked-sellers-segment: apps/console/src/lib/checked-sellers-segment.generated.json is out of date — run node scripts/gen-checked-sellers-segment.mjs",
    );
  }
  console.log(`checked-sellers-segment: current (${body.result.correct402}/${body.denominator.hosts} correct 402, measured ${body.measuredOn})`);
  process.exit(0);
}

writeFileSync(OUT, text);
console.log(
  `checked-sellers-segment: wrote ${OUT} — ${body.rows.length} hosts, ${body.result.correct402} correct 402, ` +
    `${body.result.priceMatched}/${body.result.priceCompared} price matched, measured ${body.measuredOn}`,
);
