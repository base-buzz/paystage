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

/**
 * Python's version of the same mistake (#345): `Path(__file__).resolve().parents[N]` used as the repository root.
 *
 * `py/tests/test_client.py` said `parents[3]`, which is one directory **above** the checkout, so every path it built read
 * `/home/runner/work/paystage/paystage/…` in CI and the suite failed with a FileNotFoundError that looked like a missing file. The
 * JavaScript half of this check would never see it, and the failure only appears on a clean checkout — which is the whole reason this
 * file exists.
 */
const pythonFiles = [];
const walkPy = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkPy(path);
    else if (entry.name.endsWith(".py")) pythonFiles.push(path);
  }
};
walkPy("py");
for (const path of pythonFiles) {
  const source = readFileSync(path, "utf8");
  /**
   * Only a variable named like a repository root is checked. `PACKAGE_ROOT = parents[1]` is `py/` and perfectly correct — assuming every
   * `parents[N]` means the repo root was the first false positive this branch produced, and a check that cries wolf is a check that gets
   * turned off.
   */
  for (const match of source.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*Path\(__file__\)\.resolve\(\)\.parents\[(\d+)\]/gm)) {
    if (!/REPO/i.test(match[1]) || /PACKAGE/i.test(match[1])) continue;
    if (!/packages\//.test(source)) continue;
    checked += 1;
    /** The repository root is the nearest ancestor that contains `packages/`; a `parents[N]` that overshoots it is the bug. */
    let dir = dirname(resolve(path));
    let depth = 0;
    let candidate = null;
    while (depth <= Number(match[2]) + 1) {
      if (existsSync(join(dir, "packages"))) {
        candidate = dir;
        break;
      }
      dir = dirname(dir);
      depth += 1;
    }
    let here = dirname(resolve(path));
    for (let i = 0; i < Number(match[2]); i += 1) here = dirname(here);
    if (candidate !== null && here !== candidate) {
      problems.push({
        path,
        spec: `${match[1]} = parents[${match[2]}]`,
        why: `resolves to ${here}, but the repository root is ${candidate}`
      });
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
