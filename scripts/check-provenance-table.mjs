#!/usr/bin/env node
/**
 * Fail when PROVENANCE.md no longer matches the files it describes.
 *
 *   node scripts/check-provenance-table.mjs
 *
 * Size and sha256 are the assertion. `mtime` is recorded context only: git does not preserve mtimes,
 * so asserting it would turn every clean checkout red. Content changes still fail here — which is the
 * staleness that matters.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FILES, provenanceRows } from "./gen-provenance-table.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = join(ROOT, "PROVENANCE.md");

let text;
try {
  text = readFileSync(TABLE, "utf8");
} catch {
  console.error("provenance-table: PROVENANCE.md is missing — run node scripts/gen-provenance-table.mjs");
  process.exit(1);
}

const parsed = new Map();
for (const match of text.matchAll(/^\| \[`([^`]+)`\]\([^)]+\) \| (\d+) \| [^|]+ \| `([0-9a-f]{64})` \|$/gm)) {
  parsed.set(match[1], { size: Number(match[2]), sha256: match[3] });
}

const problems = [];
for (const expected of provenanceRows(ROOT)) {
  const row = parsed.get(expected.file);
  if (!row) {
    problems.push(`${expected.file}: no row in PROVENANCE.md`);
  } else if (row.size !== expected.size || row.sha256 !== expected.sha256) {
    problems.push(
      `${expected.file}: table says ${row.size} bytes / ${row.sha256.slice(0, 12)}…, file is ${expected.size} bytes / ${expected.sha256.slice(0, 12)}…`,
    );
  }
}

for (const file of parsed.keys()) {
  if (!FILES.includes(file)) problems.push(`${file}: row is in the table but not in the generator's file list`);
}

if (problems.length > 0) {
  console.error("provenance-table: PROVENANCE.md is stale");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("  fix: node scripts/gen-provenance-table.mjs");
  process.exit(1);
}

console.log(`provenance-table: ${FILES.length} rows match size and sha256`);
