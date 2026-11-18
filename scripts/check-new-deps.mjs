#!/usr/bin/env node
/**
 * Score any dependency a pull request adds, including the ones a bot writes.
 *
 * `npm-check` runs from the pre-push hook, which a human runs and a Dependabot PR does not. So a bot could open a PR
 * adding a deprecated, hallucinated or install-script package, pass CI, and be merged by whoever is on rotation —
 * with the score that exists to prevent exactly that never having run.
 *
 *   node scripts/check-new-deps.mjs            # vs origin/main
 *   node scripts/check-new-deps.mjs --base <sha>
 *
 * Exit 0 nothing added, or everything scores 0 · 1 a hard fail · 2 cannot read the diff.
 *
 * Only *added* dependencies are scored. A bump is a different question (it keeps its score from before), and scoring
 * every bump would make this check noise people turn off.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseFlag = process.argv.indexOf("--base");
const BASE = baseFlag > 0 ? process.argv[baseFlag + 1] : "origin/main";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function diffAgainst(base) {
  return git(["diff", "--name-only", `${base}...HEAD`, "--", "*package.json"])
    .split("\n")
    .filter((f) => f && !f.includes("node_modules"));
}

let changed;
try {
  changed = diffAgainst(BASE);
} catch {
  // A shallow clone has no merge base. Fetch the base ref properly before giving up: failing here with "cannot diff"
  // is a broken check, and a broken check that exits 0 is worse than none.
  try {
    git(["fetch", "--no-tags", "--depth=200", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
    changed = diffAgainst(BASE);
  } catch (error) {
    console.error(`new-deps: cannot diff against ${BASE} (${error.message})`);
    console.error("  A shallow clone needs fetch-depth: 0, or the base ref fetched before this step runs.");
    process.exit(2);
  }
}

if (changed.length === 0) {
  console.log(`new-deps: no package.json changes against ${BASE}`);
  process.exit(0);
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const added = new Map(); // name -> { where, range }

for (const file of changed) {
  const before = (() => {
    try {
      return JSON.parse(git(["show", `${BASE}:${file}`]));
    } catch {
      return {};
    }
  })();
  const after = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
  for (const field of DEP_FIELDS) {
    const was = before?.[field] ?? {};
    const now = after?.[field] ?? {};
    for (const [name, range] of Object.entries(now)) {
      if (was[name]) continue; // a bump, not an addition
      if (name.startsWith("@paystage/")) continue; // our own workspace
      added.set(name, { where: `${file} ${field}`, range });
    }
  }
}

/**
 * Declaring a package that was **already in the tree** is not adding a dependency.
 *
 * `typescript` was installed transitively (5.9.3) and undeclared; making it explicit is the fix for #135, not a new
 * supply-chain decision. Scoring it as new would have failed the very change that closes a hole — so the test is
 * "was this in the lockfile before?", which is what "new" actually means to a reader of this check.
 */
function wasAlreadyInstalled(names) {
  const lockFile = join(ROOT, "package-lock.json");
  if (!existsSync(lockFile)) return new Set();
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  const packages = lock.packages ?? {};
  const present = new Set();
  for (const name of names) {
    for (const key of Object.keys(packages)) {
      if (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)) {
        present.add(name);
        break;
      }
    }
  }
  return present;
}

const alreadyPresent = wasAlreadyInstalled([...added.keys()]);
for (const name of alreadyPresent) {
  added.delete(name);
  console.log(`  ${name.padEnd(32)} already in the tree — now declared, not added`);
}

if (added.size === 0) {
  console.log(`new-deps: ${changed.length} package.json file(s) changed, no dependency added`);
  process.exit(0);
}

const failures = [];
for (const [name, info] of added) {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("node", ["scripts/npm-check.mjs", name], { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    code = error.status ?? 2;
    out = String(error.stdout ?? "");
  }
  const verdict = code === 0 ? "pass" : code === 1 ? "FAIL" : "FAIL (needs judgement)";
  console.log(`  ${name.padEnd(32)} ${info.where.padEnd(40)} ${verdict}`);
  // Exit 2 is "needs judgement", and a bot PR has nobody to make that judgement: CI failing is the default, and the
  // exception is a human editing this list, not a human clicking merge.
  if (code !== 0) {
    failures.push(
      `${name} (${info.where}) scored ${code === 1 ? "FAIL" : "REVIEW"}:\n${out.trim().split("\n").slice(0, 6).map((l) => `      ${l}`).join("\n")}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\nnew-deps: ${failures.length} added dependency failed the score — CI must not pass on these:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\nnew-deps: ${added.size} added dependency(ies), none hard-fail`);
