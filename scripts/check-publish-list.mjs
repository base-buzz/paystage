#!/usr/bin/env node
/**
 * Three hand-written `PKGS` lists decide what gets published, and nothing compares them.
 *
 * `release.yml` names the packages twice and `cadence.yml` a third time. A package that is not in those
 * lists is never released and never asserted — and because the lists are edited by hand, the failure is
 * silent in the worst way: the package looks finished in the repo and simply never exists on npm.
 *
 * Found 2026-11-20: `packages/` held 14 packages and the lists named 10. `@paystage/eliza-plugin` and
 * `@paystage/n8n` were publishable, unprivate, and in none of the lists. (`@paystage/receipt-verify` was in
 * the same state when this was written and was then parked `private: true`, so it is correctly absent now —
 * which is also why this check reads the flag rather than a remembered list.)
 * A comment in `cadence.yml` claimed a package added to PKGS is covered the day it is added — true, and
 * useless, because adding it needs three edits that nothing checks.
 *
 *   node scripts/check-publish-list.mjs
 *   node scripts/check-publish-list.mjs --json
 *
 * Exit 0 consistent · 1 a list disagrees, or a publishable package is missing · 2 a file could not be read
 * 2 is separate: "cannot read the workflow" must not read as "the list is wrong".
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WORKFLOWS = [
  ".github/workflows/release.yml",
  ".github/workflows/cadence.yml",
];
const asJson = process.argv.includes("--json");

const fail = (code, payload, line) => {
  if (asJson) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else console.log(line);
  process.exit(code);
};

// Every publishable package on disk. `private: true` is the only correct reason to be absent.
let publishable;
try {
  publishable = readdirSync(join(ROOT, "packages"))
    .filter((d) => existsSync(join(ROOT, "packages", d, "package.json")))
    .map((d) => {
      const pkg = JSON.parse(readFileSync(join(ROOT, "packages", d, "package.json"), "utf8"));
      return { dir: d, name: pkg.name, version: pkg.version, private: pkg.private === true };
    })
    .filter((p) => !p.private)
    .map((p) => ({ ...p, short: String(p.name).replace(/^@[^/]+\//, "") }));
} catch (error) {
  fail(2, { error: String(error.message) }, `check-publish-list: UNVERIFIABLE — packages unreadable (${String(error.message).split("\n")[0]})`);
}

// Every PKGS= line, with the file and line number so the message can name the edit.
const lists = [];
for (const rel of WORKFLOWS) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    fail(2, { error: `missing ${rel}` }, `check-publish-list: UNVERIFIABLE — ${rel} does not exist`);
  }
  const lines = readFileSync(abs, "utf8").split("\n");
  let found = 0;
  lines.forEach((line, i) => {
    const m = line.match(/PKGS="([^"]*)"/);
    if (!m) return;
    found += 1;
    lists.push({ file: rel, line: i + 1, pkgs: m[1].trim().split(/\s+/).filter(Boolean) });
  });
  if (found === 0) {
    fail(2, { error: `no PKGS= in ${rel}` }, `check-publish-list: UNVERIFIABLE — ${rel} has no PKGS= line; the check would pass by finding nothing`);
  }
}

const problems = [];

// 1. The lists must agree with each other. Different orders are fine; different sets are not.
const first = lists[0];
for (const other of lists.slice(1)) {
  const a = [...first.pkgs].sort().join(" ");
  const b = [...other.pkgs].sort().join(" ");
  if (a !== b) {
    const onlyA = first.pkgs.filter((p) => !other.pkgs.includes(p));
    const onlyB = other.pkgs.filter((p) => !first.pkgs.includes(p));
    problems.push(
      `${first.file}:${first.line} and ${other.file}:${other.line} disagree` +
        (onlyA.length ? ` — only in the first: ${onlyA.join(", ")}` : "") +
        (onlyB.length ? ` — only in the second: ${onlyB.join(", ")}` : ""),
    );
  }
}

// 2. Every publishable package must appear in every list, by its short name.
for (const list of lists) {
  for (const p of publishable) {
    if (!list.pkgs.includes(p.short)) {
      problems.push(
        `${p.name}@${p.version} is publishable but missing from ${list.file}:${list.line} — it would never be released`,
      );
    }
  }
}

// 3. A name in a list that matches no package is a dead entry, and it hides a rename.
const shorts = new Set(publishable.map((p) => p.short));
for (const list of lists) {
  for (const name of list.pkgs) {
    if (!shorts.has(name)) {
      problems.push(`${list.file}:${list.line} names "${name}", which matches no publishable package (renamed or removed?)`);
    }
  }
}

if (asJson) {
  process.stdout.write(`${JSON.stringify({ lists, publishable: publishable.map((p) => p.short), problems }, null, 2)}\n`);
  process.exit(problems.length ? 1 : 0);
}

if (problems.length === 0) {
  console.log(`check-publish-list: consistent — ${lists.length} lists agree on ${first.pkgs.length} packages, all ${publishable.length} publishable packages named`);
  process.exit(0);
}

console.log(`check-publish-list: ${problems.length} problem(s)\n`);
for (const p of problems) console.log(`  ${p}`);
console.log(
  "\n  The lists are hand-written in three places; a package missing from one is never published and never\n" +
    "  asserted. Edit all three together, or this check will keep saying so.",
);
process.exit(1);
