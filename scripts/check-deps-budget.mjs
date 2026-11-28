#!/usr/bin/env node
/**
 * A payment guard runs inside the agent's signing path, so its dependency tree is the agent's
 * attack surface. `deps-budget.json` turns the measured count into a ceiling: adding a runtime
 * dependency is a deliberate edit to that file, not a side effect of a `package.json` bump.
 *
 *   node scripts/check-deps-budget.mjs            # verify every published package
 *   node scripts/check-deps-budget.mjs --update   # write today's measurements back and print the diff
 *   node scripts/check-deps-budget.mjs --ci       # verify the umbrella + one package (the CI subset)
 *
 * Measurement, exactly as recorded in `deps-budget.json`:
 *
 *   1. `npm pack <packages/name>` — the tarball a user installs, built from this checkout.
 *   2. `npm install --ignore-scripts --no-audit --no-fund <tarball>` in an empty temp project.
 *      The temp project has no dependencies of its own, so the tree is the package's tree.
 *   3. `npm ls --all --parseable`, then drop the temp project's own root line. The count includes
 *      the package itself and every resolved copy, hoisted or nested; a duplicate copy counts
 *      twice because it is a second package on disk.
 *
 * The count is **resolved**, not declared: it sees what npm actually installed from the registry,
 * including transitive dependencies. It cannot see peer dependencies that the consumer supplies
 * (for example `ai` for `@paystage/ai-sdk`, `@x402/evm` for `@paystage/x-evm`, or `x402-fetch`
 * for `@paystage/x402-guard`) — `npm ls` only lists what is installed — and it does not see the
 * contents or capabilities of a package, only that it appeared.
 *
 * CI runs `--ci` on purpose: a full measurement downloads the whole x402/viem stack for
 * `@paystage/x402-guard` and takes about 20–30 seconds from a warm cache, while the umbrella plus
 * `@paystage/preflight` covers the packages a payment guard actually resolves in the signing path.
 * `node scripts/check-deps-budget.mjs` (no flag) measures all twelve before a release.
 *
 * Exit 0 at or below budget · 1 a package grew past its budget · 2 a measurement could not run
 * (offline, npm failed) — 2 is not a pass, because an unmeasured budget is not evidence.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_FILE = join(ROOT, "deps-budget.json");
const UPDATE = process.argv.includes("--update");
const CI = process.argv.includes("--ci");
const CONCURRENCY = 4;
const NPM_TIMEOUT_MS = 180_000;

const run = promisify(execFile);

/** Resolve package names to their workspace directories, so the budget file stores names, not paths. */
function workspacePackages() {
  const byName = new Map();
  for (const entry of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(ROOT, "packages", entry.name, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.name) byName.set(pkg.name, join(ROOT, "packages", entry.name));
    } catch {
      // A manifest that cannot be parsed cannot be measured; the missing entry is reported below.
    }
  }
  return byName;
}

async function npm(args, cwd) {
  return run("npm", args, {
    cwd,
    timeout: NPM_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", npm_config_loglevel: "error" },
  });
}

/**
 * Measure one package. The tarball is packed from the checkout, never from the registry, so a
 * budget update describes the package this commit would publish.
 */
async function measure(name, pkgDir) {
  const packDir = mkdtempSync(join(tmpdir(), "deps-budget-pack-"));
  const installDir = mkdtempSync(join(tmpdir(), "deps-budget-install-"));
  try {
    const packed = await npm(["pack", pkgDir, "--json", "--pack-destination", packDir], ROOT);
    let manifest;
    try {
      manifest = JSON.parse(packed.stdout);
    } catch {
      throw new Error(`npm pack did not return JSON: ${packed.stdout.slice(0, 300)}`);
    }
    const manifestPkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const tarball = join(packDir, manifest[0]?.filename ?? "");
    if (!existsSync(tarball)) throw new Error(`npm pack produced no tarball for ${name}`);

    writeFileSync(
      join(installDir, "package.json"),
      JSON.stringify({ name: "deps-budget-measure", version: "1.0.0", private: true }),
    );

    /**
     * Workspace dependencies are packed from this checkout too (#505).
     *
     * A release bumps `@paystage/*` versions in one commit, and the registry does not have those versions yet — so installing the tarball
     * against the real registry fails with "could not measure", which is not a pass. The measurement is about *this commit's* dependency
     * tree, so every workspace dependency it declares is packed locally and installed from those tarballs first; npm resolves the rest
     * from the registry as usual.
     */
    const workspaceTarballs = [];
    const declared = { ...(manifestPkg.dependencies ?? {}), ...(manifestPkg.peerDependencies ?? {}) };
    for (const dep of Object.keys(declared)) {
      if (!dep.startsWith("@paystage/")) continue;
      const dirName = dep.replace("@paystage/", "");
      const depDir = join(ROOT, "packages", dirName);
      if (!existsSync(join(depDir, "package.json"))) continue;
      const depPack = await npm(["pack", depDir, "--json", "--pack-destination", packDir], ROOT);
      try {
        const depManifest = JSON.parse(depPack.stdout);
        const depTar = join(packDir, depManifest[0]?.filename ?? "");
        if (existsSync(depTar)) workspaceTarballs.push(depTar);
      } catch {
        // A pack that returns no JSON is reported by the install below, with the file named.
      }
    }

    await npm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--silent",
        tarball,
        ...workspaceTarballs,
      ],
      installDir,
    );

    const listed = await npm(["ls", "--all", "--parseable"], installDir);
    const lines = listed.stdout.split("\n").filter(Boolean);
    const rootLine = resolve(installDir);
    const resolvedPackages = lines
      .filter((line) => resolve(line) !== rootLine)
      .map((line) => relative(installDir, line).split(sep).join("/"))
      .sort();
    return { name, count: resolvedPackages.length, resolvedPackages };
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
  }
}

/** Run measurements with a fixed number in flight; x402-guard's tree dominates when serialized. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const budget = existsSync(BUDGET_FILE)
  ? JSON.parse(readFileSync(BUDGET_FILE, "utf8"))
  : { packages: {} };
if (!budget.packages || typeof budget.packages !== "object") {
  console.error("deps-budget: deps-budget.json has no `packages` object — refusing to guess");
  process.exit(2);
}

const packages = workspacePackages();
const entries = Object.entries(budget.packages);
if (entries.length === 0 && !UPDATE) {
  console.error("deps-budget: deps-budget.json lists no packages — run with --update to seed it");
  process.exit(2);
}

/**
 * `--ci` is the fast subset, and it is explicit rather than silent: the umbrella is what users
 * install, and preflight is the evaluator inside it. Everything else is measured by the full run.
 */
const targets = CI
  ? entries.filter(([name]) => name === "@paystage/mcp" || name === "@paystage/preflight")
  : entries;

const missing = targets.filter(([name]) => !packages.has(name)).map(([name]) => name);
if (missing.length > 0) {
  console.error("deps-budget: these budget entries have no package in packages/ any more:");
  for (const name of missing) console.error(`  · ${name}`);
  process.exit(1);
}

let measured;
try {
  measured = await mapLimit(targets, CONCURRENCY, ([name]) => measure(name, packages.get(name)));
} catch (error) {
  console.error(`deps-budget: could not measure — this is not a pass`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  if (error && typeof error === "object" && "stderr" in error) {
    for (const line of String(error.stderr ?? "").split("\n").slice(-6)) {
      if (line.trim()) console.error(`  ${line}`);
    }
  }
  process.exit(2);
}

/** What changed, in words: the count delta and the package paths that appeared or disappeared. */
function describeChange(entry, result) {
  const before = entry.budget;
  const after = result.count;
  const delta = after - before;
  const oldPaths = new Set(entry.resolvedPackages ?? []);
  const newPaths = new Set(result.resolvedPackages);
  const added = [...newPaths].filter((p) => !oldPaths.has(p));
  const removed = [...oldPaths].filter((p) => !newPaths.has(p));
  const lines = [];
  lines.push(
    `${result.name}: ${before} → ${after} (${delta >= 0 ? "+" : ""}${delta})${
      delta === 0 ? " [unchanged]" : ""
    }`,
  );
  for (const path of added) lines.push(`    + ${path}`);
  for (const path of removed) lines.push(`    - ${path}`);
  return { delta, lines, added, removed };
}

if (UPDATE) {
  let changed = 0;
  for (const result of measured) {
    const entry = budget.packages[result.name] ?? { budget: result.count };
    const { delta, lines } = describeChange(entry, result);
    if (delta !== 0 || !entry.resolvedPackages) changed += 1;
    console.log(lines.join("\n"));
    budget.packages[result.name] = {
      ...entry,
      budget: result.count,
      resolvedPackages: result.resolvedPackages,
    };
  }
  // Keep the file ordered so a diff shows the package that moved, not a reshuffle.
  budget.packages = Object.fromEntries(
    Object.entries(budget.packages).sort(([a], [b]) => a.localeCompare(b)),
  );
  budget.measuredAt = new Date().toISOString().slice(0, 10);
  writeFileSync(BUDGET_FILE, `${JSON.stringify(budget, null, 2)}\n`);
  console.log(
    changed === 0
      ? `deps-budget: ${measured.length} measured, no budget changed`
      : `deps-budget: ${measured.length} measured, ${changed} budget(s) updated in deps-budget.json`,
  );
  process.exit(0);
}

let failed = false;
let changedBelow = 0;
for (const result of measured) {
  const entry = budget.packages[result.name];
  if (!entry) continue; // not possible: targets come from the budget
  const { delta, added } = describeChange(entry, result);
  if (delta > 0) {
    failed = true;
    console.error(
      `  FAIL ${result.name}: budget ${entry.budget}, measured ${result.count} (${delta > 0 ? "+" : ""}${delta})`,
    );
    if (added.length > 0) {
      console.error("       new resolved package(s):");
      for (const path of added) console.error(`         + ${path}`);
    } else {
      console.error("       no recorded package list to diff; the count delta is the whole change");
    }
  } else if (delta < 0) {
    changedBelow += 1;
    console.log(`  ok   ${result.name}: ${entry.budget} budget, ${result.count} measured (-${-delta})`);
  } else {
    console.log(`  ok   ${result.name}: ${result.count}/${entry.budget}`);
  }
}

if (failed) {
  console.error("\ndeps-budget: a package grew past its budget. Add the new dependency deliberately and");
  console.error("run `node scripts/check-deps-budget.mjs --update`, or remove the dependency.");
  process.exit(1);
}
console.log(
  `\ndeps-budget: ${measured.length} package(s) at or below budget${
    changedBelow > 0 ? ` (${changedBelow} below — run --update to tighten)` : ""
  }${CI ? " [CI subset: umbrella + preflight]" : ""}`,
);
process.exit(0);
