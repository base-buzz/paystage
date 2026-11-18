#!/usr/bin/env node
/**
 * The access table claims a set of environment variables; the code reads another (#139).
 *
 * A claim about what a process touches is exactly the kind of copy that rots unnoticed: SECURITY.md says "one policy
 * file, two environment variables", the code grows a third, and the sentence stays confidently wrong. This compares the
 * two directions and fails on either asymmetry.
 *
 *   node scripts/check-env-vars.mjs
 *
 * Exit 0 both directions agree · 1 an asymmetry · 2 cannot read a required file.
 *
 * A variable read only under a test or a dev script does not count as a promise about production; the allowlist below
 * is for those, and each entry needs a reason beside it.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Read but deliberately not published: internal wiring a reader has no way to set. */
const INTERNAL = new Set([
  "NODE_ENV", // set by the runtime, not by a caller
  "CI", // set by the runner
  "GITHUB_ACTIONS", // set by the runner
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".next", ".open-next", ".wrangler"].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(ts|mjs|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Every surface that reads configuration: the workers, the console, the packages a reader runs, and the scripts that
// document themselves through environment variables.
const sources = [
  ...walk(join(ROOT, "apps/hosted/src")),
  ...walk(join(ROOT, "apps/console/src")),
  ...walk(join(ROOT, "packages")),
  ...walk(join(ROOT, "scripts")),
  ...walk(join(ROOT, "apps/hosted/scripts")),
  ...walk(join(ROOT, "apps/console/scripts")),
];
const read = new Set();
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/(?:process\.)?env\??\.\s*([A-Z][A-Z0-9_]{2,})/g)) read.add(m[1]);
  for (const m of text.matchAll(/(?:process\.)?env\["([A-Z][A-Z0-9_]{2,})"\]/g)) read.add(m[1]);
  // `env as { NAME?: string }` — the cast form, which the dot pattern cannot see and which hid a real read.
  for (const block of text.matchAll(/env as \{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/([A-Z][A-Z0-9_]{2,})\??:/g)) read.add(m[1]);
  }
}
for (const name of INTERNAL) read.delete(name);

/** Where we promise what is touched. Both are read; a name in either counts as documented. */
const DOCS = ["SECURITY.md", "apps/hosted/README.md"];
const documented = new Set();
let readabledocs = 0;
for (const doc of DOCS) {
  const path = join(ROOT, doc);
  if (!existsSync(path)) continue;
  readabledocs += 1;
  const text = readFileSync(path, "utf8");
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    if (read.has(m[1]) || /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(m[1])) documented.add(m[1]);
  }
}

if (readabledocs === 0) {
  console.error("env-vars: neither SECURITY.md nor apps/hosted/README.md could be read — nothing to compare against");
  process.exit(2);
}

const undocumented = [...read].filter((name) => !documented.has(name)).sort();
const problems = [];

if (undocumented.length > 0) {
  problems.push(
    `read in code but not named in SECURITY.md or apps/hosted/README.md: ${undocumented.join(", ")}`,
  );
}
// The other direction: a documented variable that no code reads is a claim about a setting that does nothing.
const stale = [...documented].filter((name) => !read.has(name)).sort();
if (stale.length > 0) {
  problems.push(`documented but never read: ${stale.join(", ")} — a setting that does nothing is a wrong claim`);
}

if (problems.length === 0) {
  console.log(`env-vars: ${read.size} variable(s) read, all documented and all live`);
  process.exit(0);
}
console.error("env-vars: the access table and the code disagree:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
