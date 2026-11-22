#!/usr/bin/env node
/**
 * Every curated drainer address must carry its own citation, and that citation must still be checkable.
 *
 *   node scripts/check-drainer-citations.mjs [--file <path>] [--max-age-days 180] [--quiet]
 *
 * Exit 0 every entry has a source or is explicitly `unattributed` · 1 a citation is missing, not https, or stale · 2 nothing to check
 *
 * Why 180 days, not the comparison matrix's 90: a comparison cell is a live product claim and a quarter is
 * already generous. A drainer citation is a historical incident that does not change, but the URL behind it
 * can move, 404 or be rewritten, so the date records when a curator last opened it. Six months is a
 * re-verification cadence, not a claim that the incident is recent. If the list needs faster refresh than
 * that, the missing thing is a source monitor, not a shorter window.
 *
 * An explicit `source: "unattributed"` is allowed and counted, because the alternative is inventing a URL.
 * A missing/blank source is not the same thing and fails; `--strict-unattributed` also fails when any entry
 * is explicitly unattributed, for a release that refuses to ship an unsourced block.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fileFlag = args.indexOf("--file");
const file = fileFlag >= 0 ? resolve(args[fileFlag + 1]) : join(ROOT, "packages/preflight/src/known-drainers.ts");
const maxAge = Number(args.includes("--max-age-days") ? args[args.indexOf("--max-age-days") + 1] : 180);
const quiet = args.includes("--quiet");
const strict = args.includes("--strict-unattributed");
const DAY = 86_400_000;

if (!existsSync(file)) {
  console.error(`drainer-citations: no file at ${file}`);
  process.exit(2);
}
if (!Number.isFinite(maxAge) || maxAge <= 0) {
  console.error("drainer-citations: --max-age-days must be a positive number");
  process.exit(2);
}

const sourceText = readFileSync(file, "utf8");
const start = sourceText.indexOf("export const DRAINER_ENTRIES");
const end = start >= 0 ? sourceText.indexOf("\n]);", start) : -1;
if (start < 0 || end < 0) {
  console.error(`drainer-citations: no DRAINER_ENTRIES block in ${file}`);
  process.exit(2);
}
const block = sourceText.slice(start, end);

/**
 * One object per entry, parsed field by field so a missing field is reported by name instead of the whole
 * entry being skipped. The objects are flat and contain no nested braces.
 */
const objects = [...block.matchAll(/\{\s*([\s\S]*?)\n\s*\},?/g)].map(([, body]) => body);
const declaredEntries = (block.match(/^\s*\{$/gm) ?? []).length;
const problems = [];
const seen = new Set();
let attributed = 0;
let unattributed = 0;
const today = new Date().toISOString().slice(0, 10);

if (objects.length !== declaredEntries) {
  problems.push(`parsed ${objects.length} entries but the block declares ${declaredEntries} — an entry is malformed`);
}

for (const body of objects) {
  const address = /address:\s*"([^"]*)"/.exec(body)?.[1] ?? null;
  const source = /source:\s*"([^"]*)"/.exec(body)?.[1] ?? null;
  const readDate = /readDate:\s*"(?:[^"]*)"/.test(body)
    ? /readDate:\s*"([^"]*)"/.exec(body)?.[1]
    : /readDate:\s*null/.test(body)
      ? null
      : undefined;
  const label = address ?? "(entry with no address)";

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    problems.push(`${label}: address is missing or not a 20-byte hex address`);
    continue;
  }
  if (seen.has(address.toLowerCase())) {
    problems.push(`${label}: duplicate entry`);
    continue;
  }
  seen.add(address.toLowerCase());

  if (!source || source.trim().length === 0) {
    problems.push(`${label}: no source — add an https URL or the literal "unattributed"`);
    continue;
  }

  if (source === "unattributed") {
    unattributed += 1;
    if (strict) problems.push(`${label}: explicitly unattributed (--strict-unattributed)`);
    continue;
  }

  if (!/^https:\/\//.test(source)) {
    problems.push(`${label}: source is not an https:// URL (${source.slice(0, 60)})`);
    continue;
  }

  if (readDate === undefined) {
    problems.push(`${label}: no readDate`);
    continue;
  }
  if (readDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(readDate)) {
    problems.push(`${label}: readDate is not YYYY-MM-DD`);
    continue;
  }
  const ageDays = Math.floor((Date.parse(today) - Date.parse(readDate)) / DAY);
  if (!Number.isFinite(ageDays)) {
    problems.push(`${label}: readDate ${readDate} is not a date`);
  } else if (ageDays < 0) {
    problems.push(`${label}: readDate ${readDate} is in the future`);
  } else if (ageDays > maxAge) {
    problems.push(`${label}: read ${ageDays} days ago, older than the ${maxAge}-day window`);
  } else {
    attributed += 1;
  }
}

if (objects.length === 0) {
  console.error(`drainer-citations: no entries parsed from ${file}`);
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`drainer-citations: FAIL — ${problems.length} problem(s) across ${objects.length} entries`);
  for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
  if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`);
  process.exit(1);
}

if (!quiet) {
  console.log(
    `drainer-citations: ok — ${objects.length} entries, ${attributed} attributed, ${unattributed} unattributed, all cites read within ${maxAge} days`,
  );
}
