#!/usr/bin/env node
/**
 * Copy the Bazaar demand counter sample the console renders (#375).
 *
 * The collector (`/work/ops/bin/bazaar-demand.mjs`) samples the first five pages of the CDP Bazaar discovery endpoint and
 * writes `docs/state/bazaar-demand.json` on the ops volume, which the console cannot read at build or request time. This
 * script copies that state into the repository so `/lab` stays a static read and any drift is a diff in git, the same
 * shape as `lists.generated.ts`.
 *
 * The `note` is copied too, verbatim: it is the label that must travel with the number — *calls, not settled payments,
 * and not revenue* — and the page renders it from this file rather than retyping it in JSX. The guard below refuses a
 * state file whose note has lost that wording, because a copy without the label is the number this row exists to avoid.
 *
 *   node scripts/gen-bazaar-demand.mjs          # write
 *   node scripts/gen-bazaar-demand.mjs --check  # exit 1 when out of date, 2 when the source is not mounted
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.env.PAYSTAGE_BAZAAR_DEMAND ?? "/work/ops/docs/state/bazaar-demand.json";
const OUT = join(ROOT, "apps/console/src/lib/bazaar-demand.generated.json");

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

if (!existsSync(SOURCE)) {
  fail(2, `bazaar-demand: no collector state at ${SOURCE} — cannot verify or refresh the page copy; set PAYSTAGE_BAZAAR_DEMAND to the collector's output`);
}

let snapshot;
try {
  snapshot = JSON.parse(readFileSync(SOURCE, "utf8"));
} catch (error) {
  fail(2, `bazaar-demand: ${SOURCE} is not readable JSON — ${String(error.message).slice(0, 120)}`);
}

/**
 * The page cannot render a counter without its definition (#375): the sample size, the page rule and the 30-day field
 * are what make the number a measurement rather than a guess. Refuse to copy a state file that cannot supply them.
 */
const note = typeof snapshot.note === "string" ? snapshot.note.trim() : "";
if (note === "") {
  fail(1, "bazaar-demand: the collector state has no note — refusing to copy a counter without its label");
}
if (!note.includes("not settled payments") || !note.includes("not revenue")) {
  fail(1, "bazaar-demand: the note no longer says calls, not settled payments, and not revenue — refusing to copy a counter whose label has drifted");
}
if (!Number.isInteger(snapshot.resources) || snapshot.resources <= 0) {
  fail(1, `bazaar-demand: the collector state has no positive integer resources (${String(snapshot.resources)})`);
}
if (!Number.isInteger(snapshot.pagesRead) || snapshot.pagesRead <= 0) {
  fail(1, `bazaar-demand: the collector state has no positive integer pagesRead (${String(snapshot.pagesRead)})`);
}
if (!Number.isFinite(Number(snapshot.totalCalls30d))) {
  fail(1, `bazaar-demand: the collector state has no readable totalCalls30d (${String(snapshot.totalCalls30d)})`);
}
if (typeof snapshot.sampledFrom !== "string" || snapshot.sampledFrom.trim() === "") {
  fail(1, "bazaar-demand: the collector state has no sampledFrom — the sampling rule must travel with the sample");
}
if (typeof snapshot.measuredAt !== "string" || Number.isNaN(Date.parse(snapshot.measuredAt))) {
  fail(1, `bazaar-demand: the collector state has no readable measuredAt (${String(snapshot.measuredAt)})`);
}

/** A verbatim copy, so the committed file is the collector's bytes and not a second rendering of them. */
const body = `${readFileSync(SOURCE, "utf8").trimEnd()}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== body) {
    fail(1, "bazaar-demand: apps/console/src/lib/bazaar-demand.generated.json is out of date — run node scripts/gen-bazaar-demand.mjs");
  }
  console.log("bazaar-demand: current");
  process.exit(0);
}

writeFileSync(OUT, body);
console.log(
  `bazaar-demand: wrote ${OUT} — ${snapshot.resources} resource(s) over ${snapshot.pagesRead} page(s), ${Number(snapshot.totalCalls30d).toLocaleString("en-US")} calls/30d, labelled as calls, not revenue`,
);
