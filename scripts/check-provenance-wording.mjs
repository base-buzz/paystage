#!/usr/bin/env node
/**
 * Public copy records provenance, it does not grade motive (AGENTS.md rule 3).
 *
 *   node scripts/check-provenance-wording.mjs
 *
 * Exit 0 the copy is clean · 1 forbidden wording in user-facing text · 2 a file could not be read.
 *
 * Why this exists: "synthetic traffic" came back three times after being corrected twice, because a rule enforced by memory is not enforced. The distinction that matters is not shown vs
 * hidden — it is labelled vs unlabelled. So the word may still appear as a *data value* (`source: "synthetic"` in the events table, and the code that counts it), and never as a phrase in
 * text a reader sees: no "synthetic traffic", no "test traffic", no "fake", no "not a real user".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Derived from this file's location: a hardcoded container path passes here and dies in CI with ENOENT.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Copy surfaces: pages and components under the console, plus the top-level docs a reader lands on. */
const DIRS = ["apps/console/src", "apps/hosted/src"];
const DOCS = ["README.md", "docs/why-preflight.md", "docs/pricing.md", "SECURITY.md"];

/** Phrases that are forbidden in copy. Case-insensitive, word-boundary where it matters. */
const FORBIDDEN = [
  /\bsynthetic (traffic|probe|payment|user)s?\b/i,
  /\btest (traffic|user)s?\b/i,
  /\bfake (traffic|user|payment)s?\b/i,
  /\bnot a real (user|customer|payer)\b/i,
];

/** Lines that are code, not copy: an identifier, a data value, or a comment explaining the schema. */
const CODE_SHAPE = /source\s*[:=]|===?\s*"synthetic"|"synthetic"\s*===?|synthetic:\s*0|syntheticCount|\bsynthetic\b\s*\+?\+?;|import |export type/;

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist"].includes(entry.name)) continue;
      walk(full, out);
    } else if ([".ts", ".tsx", ".md"].includes(extname(entry.name))) out.push(full);
  }
  return out;
};

const files = [...DIRS.flatMap((d) => walk(join(ROOT, d))), ...DOCS.map((d) => join(ROOT, d))];
const hits = [];
for (const file of files) {
  let text;
  try {
    statSync(file);
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    if (CODE_SHAPE.test(line)) return;
    for (const pattern of FORBIDDEN) {
      if (pattern.test(line)) {
        hits.push({ file: file.replace(`${ROOT}/`, ""), line: i + 1, text: line.trim().slice(0, 100) });
        break;
      }
    }
  });
}

if (hits.length === 0) {
  console.log(`provenance-wording: clean — ${files.length} file(s), no motive language in copy`);
  process.exit(0);
}
console.error(`provenance-wording: ${hits.length} line(s) grade motive instead of recording provenance (rule 3)`);
for (const h of hits.slice(0, 12)) console.error(`  ${h.file}:${h.line}  ${h.text}`);
console.error("  say who caused it: our loadgen / our probe / operator agent / unknown payer — never \"synthetic\" or \"fake\"");
process.exit(1);
