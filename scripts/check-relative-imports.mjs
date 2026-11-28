#!/usr/bin/env node
/**
 * Every relative import in a script must point at a file that exists (#CI, 2026-11-28).
 *
 * `apps/hosted/scripts/e2e-paid.mjs` imported `../../packages/loadgen/src/provenance.mjs`, which resolves to `apps/packages/…` — one
 * `../` short of the repo root. Nothing local noticed: `ci-local` does not execute the paid end-to-end script (it needs a funded key),
 * and the workflow that does only runs on a tag or a schedule, so the first run after we started tagging failed in GitHub with
 * ERR_MODULE_NOT_FOUND while every local gate was green.
 *
 * A path is decidable without running anything, which is exactly the kind of check that belongs in the local gate: it reads every
 * relative specifier in the JavaScript we ship and asserts the target exists on disk.
 *
 *   node scripts/check-relative-imports.mjs
 *
 * Exit 0 every relative import resolves · 10 one does not · 2 the scan found no files (which means the scan is wrong).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOTS = ["apps", "packages", "scripts", "examples"];
const SKIP = new Set(["node_modules", ".next", ".open-next", "dist", ".wrangler", "coverage", ".turbo"]);

/** Files whose relative imports we check. `.ts` is excluded because TS resolution rules differ; `.mjs`/`.js` are what Node runs. */
const EXTS = [".mjs", ".js", ".cjs"];

const files = [];
const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (EXTS.some((ext) => entry.name.endsWith(ext))) files.push(path);
  }
};

for (const root of ROOTS) if (existsSync(root)) walk(root);
if (files.length === 0) {
  console.error("relative-imports: found no JavaScript files — the scan is wrong, not the imports");
  process.exit(2);
}

/** A specifier may name the file directly, or omit an extension Node would add. */
const resolves = (fromDir, spec) => {
  const target = resolve(fromDir, spec);
  if (existsSync(target) && statSync(target).isFile()) return true;
  return [".mjs", ".js", ".cjs", ".json"].some((ext) => existsSync(target + ext));
};

const problems = [];
let checked = 0;
for (const path of files) {
  const source = readFileSync(path, "utf8");
  /** Static imports, re-exports and dynamic `import("…")` with a literal — the three ways a path is written. */
  const specifiers = [
    ...source.matchAll(/(?:^|\n)\s*(?:import|export)[^"'`\n]*?from\s+["']([^"']+)["']/g),
    ...source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  for (const spec of specifiers) {
    if (!spec.startsWith(".")) continue;
    checked += 1;
    if (!resolves(dirname(path), spec)) {
      problems.push({ path, spec, why: `resolves to ${resolve(dirname(path), spec)}, which does not exist` });
    }
  }
}

if (problems.length === 0) {
  console.log(`relative-imports: ${checked} relative import(s) across ${files.length} file(s), all resolve`);
} else {
  console.log(`relative-imports: ${problems.length} of ${checked} relative import(s) point at nothing`);
  for (const problem of problems.slice(0, 20)) console.log(`  ${problem.path}: "${problem.spec}" — ${problem.why}`);
  if (problems.length > 20) console.log(`  … and ${problems.length - 20} more`);
  console.log("  a broken path is decidable without running anything, which is why it belongs in the local gate");
}
process.exit(problems.length === 0 ? 0 : 10);
