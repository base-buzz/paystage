#!/usr/bin/env node
/**
 * A test that reads a file from disk must read one git tracks (#CI, 2026-11-28).
 *
 * The fast pass in `ci-local` runs **in the working tree**, so a test that reads an untracked path — a migration, a fixture written by a
 * previous run, anything gitignored — passes locally and fails in CI, where the checkout holds only tracked files. That exact gap produced
 * two red GitHub runs tonight: `supabase/migrations` was untracked by operator decision, the two tests that read it passed here and threw
 * `Cannot read properties of null` there.
 *
 * This is decidable without running anything: take each literal path a test builds from `import.meta.dirname`, resolve it, and ask git
 * whether that path is tracked. If it is not, the test is green here and red in CI, which is the worst combination a gate can allow.
 *
 *   node scripts/check-tests-read-tracked.mjs
 *
 * Exit 0 every literal test path is tracked · 10 one is not · 2 git could not be asked.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const TRACKED = new Set(
  (() => {
    try {
      return execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      console.error(`tests-read-tracked: could not list tracked files (${error?.code ?? "git failed"})`);
      process.exit(2);
    }
  })(),
);

const TEST_DIRS = ["apps", "packages"];
const isTest = (name) => /\.(test|spec)\.[cm]?[jt]s$/.test(name);
const files = [];
const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (["node_modules", ".next", ".open-next", "dist"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (isTest(entry.name)) files.push(path);
  }
};
for (const root of TEST_DIRS) walk(root);
if (files.length === 0) {
  console.error("tests-read-tracked: found no test files — the scan is wrong");
  process.exit(2);
}

const problems = [];
let checked = 0;
for (const path of files) {
  const source = readFileSync(path, "utf8");
  /** `join(import.meta.dirname, "…")` / `resolve(__dirname, "…")` with a single literal argument. */
  for (const match of source.matchAll(/(?:join|resolve)\(\s*import\.meta\.dirname\s*,\s*"([^"]+)"\s*\)/g)) {
    const target = resolve(dirname(path), match[1]);
    checked += 1;
    if (!existsSync(target)) continue; // absent everywhere; the test already has to cope
    /**
     * A **directory** is not a tracked path — git tracks files — so `join(import.meta.dirname, "..")` would always look untracked. The hazard
     * this check exists for is a file CI will not have, not a parent directory.
     */
    if (statSync(target).isDirectory()) continue;
    /**
     * `supabase/migrations/` is a **deliberate** exception (operator decision, 2026-11-28): the schema is no longer published, and the two
     * tests that read it skip with a named reason when it is absent. Anywhere else, an untracked fixture is a green-here/red-there bug.
     */
    if (relative(process.cwd(), target).startsWith("supabase/")) continue;
    const trackedPath = relative(process.cwd(), target);
    if (!TRACKED.has(trackedPath)) {
      problems.push({ path, spec: match[1], target: trackedPath, why: "exists here but is not tracked, so CI will not have it" });
    }
  }
}

if (problems.length === 0) {
  console.log(`tests-read-tracked: ${checked} literal path(s) in ${files.length} test file(s), all tracked`);
} else {
  console.log(`tests-read-tracked: ${problems.length} of ${checked} literal test path(s) point at untracked files`);
  for (const problem of problems.slice(0, 20)) console.log(`  ${problem.path}: "${problem.spec}" — ${problem.why}`);
  console.log("  a test green here and red in CI is the worst combination a local gate can allow");
}
process.exit(problems.length === 0 ? 0 : 10);
