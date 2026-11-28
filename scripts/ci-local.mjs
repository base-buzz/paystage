#!/usr/bin/env node
/**
 * Run what CI runs, before the push — in a **clean checkout**, because that is the environment that keeps catching us.
 *
 * Every failure today had the same shape: green here, red on GitHub. A missing `node_modules` in a workflow, a package
 * that builds against a stale local `node_modules` and fails on a fresh install, a test that hardcoded a count. None of
 * them was visible in a working tree that had been installed for hours.
 *
 *   node scripts/ci-local.mjs              # decide from what changed
 *   node scripts/ci-local.mjs --full       # always: clean install, build, every test, every check
 *   node scripts/ci-local.mjs --changed <sha>   # compare against a base (default origin/main)
 *
 * Exit 0 nothing that CI would fail · 1 it would · 2 cannot run here (offline, no npm).
 *
 * Deliberately heavy: a `git worktree` at the pushed commit, `npm ci`, `npm run build`, then the test suites and the
 * scripts CI runs. Minutes, not seconds — which is why it is not the default for every push. It runs when the push
 * touches something that can only break on a fresh install (lockfiles, a package manifest, a workflow), and `--full`
 * forces it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const full = args.includes("--full");
const baseFlag = args.indexOf("--changed");
const base = baseFlag >= 0 ? args[baseFlag + 1] : "origin/main";

function git(argv, cwd = ROOT) {
  return execFileSync("git", argv, { cwd, encoding: "utf8" }).trim();
}

/**
 * Runs a check that depends on a third party and never fails the pass.
 *
 * `scripts/check-facilitator-gas.mjs` needs Base's RPC. A red gate on someone else's endpoint is the
 * failure mode we keep deleting: on 2026-11-27 a shields.io 504 failed a cold run for a change that
 * could not have caused it, and a gate that blocks on an outage gets bypassed with `--no-verify` and
 * then protects nothing. So both "below the floor" (exit 10) and "RPC unreadable" (exit 2) are
 * printed here as facts; the operator decision is a refill, not a red build. The script still
 * separates the two exit codes for anyone who runs it directly.
 */
function runAdvisory(label, command, commandArgs, cwd) {
  const started = Date.now();
  try {
    const out = execFileSync(command, commandArgs, { cwd, stdio: "pipe", encoding: "utf8", timeout: 120_000 });
    console.log(`  advisory ${label} — exit 0 (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    for (const line of out.trim().split("\n")) console.log(`        ${line}`);
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    console.log(`  advisory ${label} — exit ${error.status ?? "?"}, not a gate`);
    for (const line of output.split("\n").filter(Boolean).slice(-4)) console.log(`        ${line}`);
  }
}

/**
 * What can only break on a fresh install?
 *
 * - a lockfile or a package manifest: the install itself changes;
 * - a workflow: CI-only code, which no local command exercises;
 * - the build script: what gets built before publishing.
 * A test or source change is covered by the fast pre-push checks and by the suites below.
 */
function needsColdRun() {
  if (full) return "requested (--full)";
  let changed;
  try {
    changed = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
    changed.push(...git(["diff", "--name-only"]).split("\n").filter(Boolean));
  } catch {
    return "cannot diff against the base, so the safe answer is to run it";
  }
  const patterns = [
    /package-lock\.json$/,
    /package\.json$/,
    /^\.github\/workflows\//,
    /^\.githooks\//,
  ];
  const hit = changed.find((file) => patterns.some((re) => re.test(file)));
  return hit ? `touched ${hit}` : null;
}

const reason = needsColdRun();

/**
 * No cold reason is not "nothing to check".
 *
 * A source change can still fail the build — the raw-shape bug compiled locally against an old `node_modules` and broke
 * on a clean install, and a plain type error would have been caught in either. So the fallback is a fast in-place pass:
 * build plus every test suite, which is ~15 seconds here and catches the ordinary class.
 */
if (reason === null) {
  console.log("ci-local: no clean-install trigger — running the fast pass (build + tests)");
  let failedFast = false;
  const runFast = (label, command, commandArgs, cwd) => {
    const started = Date.now();
    try {
      execFileSync(command, commandArgs, { cwd, stdio: "pipe", encoding: "utf8", timeout: 900_000 });
      console.log(`  ok    ${label} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    } catch (error) {
      failedFast = true;
      console.error(`  FAIL  ${label}`);
      for (const line of `${error.stdout ?? ""}${error.stderr ?? ""}`.split("\n").slice(-10)) console.error(`        ${line}`);
    }
  };
  /**
   * Doc/code drift checks run in the fast pass too.
   *
   * On 2026-11-24 CI failed on `check-env-vars` — six variables added by the measurement-registry work were read in code and absent from SECURITY.md — while every local run was green,
   * because these checks live in the cold block that only triggers on a lockfile, workflow or build-script change. A text change that adds an env var is exactly the case the gate
   * missed, so the cheap ones run here as well: each is sub-second and none touches the network.
   */
  for (const cheap of [
    "check-env-vars.mjs",
    "check-version-parity.mjs",
    "check-copy.mjs",
    "check-doc-links.mjs",
    "check-count-claims.mjs",
    "check-claims.mjs",
    "gen-glossary.mjs --check",
    "check-provenance-wording.mjs",
    "check-provenance-table.mjs",
    "check-examples.mjs",
    "check-pass-assets.mjs",
    /* #480: `/mocks/index.json` is generated from the page's own data. A hand edit, a missing image, a fifth frame
       or a card chip more mature than its frames is red here, not in a review. */
    "check-mocks-index.mjs",
    /* #482: `/lab/mesh` renders a committed snapshot. A missing latest.json, a row without a tx, a
       filename/window mismatch, or aggregates that stop summing to the rows is red here. */
    "check-soak-mesh.mjs",
    /* #457: the kit's geometry, the generated sizes, the zero-byte class of failure, and — since the mark change —
       the freshness ledger: every asset is hashed against its masters, so a half-run `brand:rebuild` is red here. */
    "check-brand-assets.mjs",
    "check-brand-commands.mjs",
    "check-hardcoded-paths.mjs",
    /* #497: the directory page and its JSON must read one snapshot, every row must be dated and sourced, and a demand
       figure may not appear without x402scan's name and capture date. */
    "check-directory.mjs",
    /* #490: the pricing page's "has anyone paid us" sentence must be the committed classifier snapshot, every transfer
       must be classified against the published list, and the last-external date must be derived, not typed. */
    "check-payments-incoming.mjs",
    "check-unit-economics.mjs",
    "check-relative-imports.mjs",
    "check-migrations-private.mjs",
    "check-tests-read-tracked.mjs",
    "check-workspace-pins.mjs",
    /**
     * In `ci.yml` but not in this list until 2026-11-26, which is how a new package (`@paystage/mandate`) reached main
     * with CI red while `ci-local` said green. A local gate that runs a different set of checks than CI is the same
     * failure as a hook that cannot see the runner (#439): it converts "unknown" into "verified".
     */
    "check-manifest-packages.mjs",
    /**
     * `apps/hosted/scripts/conformance.mjs` is what the nightly `cadence` workflow runs, and it was not in this list —
     * so a broken relative import in it (2026-11-26: `../../packages` from `apps/hosted/scripts/`, which resolves to
     * `apps/packages`) passed every local check and failed the nightly run at 02:40Z. Fixtures only, no network, ~1s.
     */
    "conformance-fixtures.mjs",
    /* Three hand-written PKGS lists decide what publishes; this compares them. It ran in CI but not here, so a
       package dropped from one list went red on the runner and green at the desk (2026-11-26). */
    "check-publish-list.mjs",
    /* #454: the demo's copy must say budget, not crypto. A vocabulary rule is a grep, and a grep that only runs in CI is
       a rule that ships broken. */
    "check-demo-vocabulary.mjs",
    /* #461: the site says "0 keys held". A claim nobody attacks is a liability, so something attacks it on every run. */
    "check-no-keys.mjs",
    /* #465: llms.txt is the first thing an agent reads, and nothing parsed it. */
    "check-llms-txt.mjs",
    /* #468: every domain we own must have an agent entry point, and the two brands must name each other. */
    "check-agent-entry.mjs",
    /* The agent-facing endpoint lists and the OpenAPI document must be the same list. Sub-second, no network, and
       exactly the kind of hand-maintained surface that drifts while every local run is green. */
    "check-route-docs.mjs",
    "check-openapi-parity.mjs",
    /* #476: reads the built HTML, so it runs after the build in both passes. */
    "check-structured-data.mjs",
  ]) {
    const [script, ...scriptArgs] = cheap.split(" ");
    if (!existsSync(join(ROOT, "scripts", script))) continue;
    runFast(cheap, "node", [join("scripts", script), ...scriptArgs], ROOT);
  }
  runFast("npm run build", "npm", ["run", "build", "--silent"], ROOT);
  for (const dir of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgDir = join(ROOT, "packages", dir.name);
    if (!existsSync(join(pkgDir, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    if (!manifest.scripts?.test) continue;
    runFast(`test ${manifest.name}`, "npm", ["test", "--silent", "-w", manifest.name], ROOT);
  }
  for (const app of ["hosted", "console"]) {
    const appDir = join(ROOT, "apps", app);
    if (!existsSync(join(appDir, "package.json"))) continue;
    runFast(`test apps/${app}`, "npx", ["vitest", "run"], appDir);
  }
  // The seller example's critical test: removing the gate call must turn CI red.
  if (existsSync(join(ROOT, "examples/seller/seller.test.mjs"))) {
    runFast("test examples/seller", "node", ["--test", "examples/seller/seller.test.mjs"], ROOT);
  }
  // Advisory: the gas wallet's balance needs Base's RPC. See runAdvisory for why it cannot gate.
  if (existsSync(join(ROOT, "scripts/check-facilitator-gas.mjs"))) {
    runAdvisory("check-facilitator-gas", "node", [join("scripts", "check-facilitator-gas.mjs")], ROOT);
  }
  if (failedFast) {
    console.error("\nci-local: CI would fail on this commit. Fix it here, or push with --no-verify and say why.");
    process.exit(1);
  }
  console.log("\nci-local: build and tests pass.");
  process.exit(0);
}
console.log(`ci-local: cold run (${reason})`);

const worktree = mkdtempSync(join(tmpdir(), "ci-local-"));
let failed = false;
/** Set when the failure was a SIGKILL rather than a red check — the summary must say which. */
let killed = false;

function run(label, command, commandArgs, cwd) {
  const started = Date.now();
  try {
    execFileSync(command, commandArgs, { cwd, stdio: "pipe", encoding: "utf8", timeout: 900_000 });
    console.log(`  ok    ${label} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  } catch (error) {
    failed = true;
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    /**
     * A killed process is not a failed check, and saying "install failed" about an OOM sends the reader to the wrong file.
     *
     * Measured 2026-11-20: two runs exited 1 with an empty install log while a clean `npm ci` in the same container succeeded —
     * the npm child had been SIGKILLed (137) at this container's 3 GB limit while other work was running, and `npm ci --silent`
     * wrote nothing before it died, so the output looked like a silent failure of the code under test. It was memory pressure.
     */
    if (error.signal === "SIGKILL" || error.status === 137 || /\bKilled\b/.test(output)) {
      killed = true;
      const capMiB = (() => {
        try {
          return String(Math.round(Number(readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim()) / 1024 / 1024));
        } catch {
          return null;
        }
      })();
      console.error(`  FAIL  ${label} — KILLED, not failed: the process was SIGKILLed (exit 137)`);
      console.error(
        `        this is almost always memory pressure, e.g. another build running; the container cap is ${capMiB === null ? "unknown" : `${capMiB} MiB`}, \`cat /sys/fs/cgroup/memory.current\` shows the current use`,
      );
      console.error(`        nothing here says the code is broken — re-run when the container is quieter`);
      return;
    }
    console.error(`  FAIL  ${label}`);
    for (const line of output.split("\n").slice(-12)) console.error(`        ${line}`);
  }
}

try {
  git(["worktree", "add", "--detach", worktree, "HEAD"]);
  console.log(`  clean checkout at ${worktree}`);

  /**
   * `--ignore-scripts`, and the reason is not convenience.
   *
   * A plain `npm ci` compiles `utf-8-validate` with node-gyp here and fails: this container has no C toolchain, while a
   * GitHub runner does. Installing without lifecycle scripts still gives the thing this check needs — a **clean**
   * `node_modules` built from the lockfile, which is where every "green here, red on CI" failure today came from. What
   * it does not cover is a native build, and that is stated rather than hidden: if a dependency starts needing one, CI
   * is the place that finds out.
   */
  run("npm ci --ignore-scripts", "npm", ["ci", "--ignore-scripts", "--silent"], worktree);
  /**
   * The last line is the one that gets copied into a report, so it must carry the classification, not just the fact.
   *
   * Measured 2026-11-21: a peer's report said "install failed" while the run had correctly printed "KILLED, not failed" —
   * the detail was right and the summary was wrong, so the reader was sent to look for a dependency bug that did not
   * exist. Same class as quoting a pre-push hook instead of the push's exit code.
   */
  if (failed) {
    throw new Error(
      killed
        ? "nothing ran — the install was KILLED (memory pressure), not a code failure; re-run when the container is quieter"
        : "install failed — nothing after this means anything",
    );
  }

  run("npm run build", "npm", ["run", "build", "--silent"], worktree);

  // The suites CI runs, per workspace.
  for (const dir of readdirSync(join(worktree, "packages"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgDir = join(worktree, "packages", dir.name);
    if (!existsSync(join(pkgDir, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    if (!manifest.scripts?.test) continue;
    run(`test ${manifest.name}`, "npm", ["test", "--silent", "-w", manifest.name], worktree);
  }
  for (const app of ["hosted", "console"]) {
    const appDir = join(worktree, "apps", app);
    if (!existsSync(join(appDir, "package.json"))) continue;
    /**
     * `apps/hosted` sits outside the npm workspace and has its own lockfile (#119), so the root install does not cover
     * it. Skipping this step is how a clean checkout reported `Cannot find package '@x402/hono'` — the app was being
     * tested with no dependencies installed at all.
     */
    if (existsSync(join(appDir, "package-lock.json"))) {
      run(`install apps/${app}`, "npm", ["ci", "--ignore-scripts", "--silent"], appDir);
    }
    run(`test apps/${app}`, "npx", ["vitest", "run"], appDir);
  }

  if (existsSync(join(worktree, "examples/seller/seller.test.mjs"))) {
    run("test examples/seller", "node", ["--test", "examples/seller/seller.test.mjs"], worktree);
  }

  // The checks CI runs as separate steps.
  for (const check of [
    // Also enforces docs/state/measurements.json (#388): a registry entry past refresh_days, or a number a page
    // renders with no entry, is red here — the registry is committed, so this works in a clean checkout.
    "check-claims.mjs",
    "check-client-manifests.mjs",
    "check-agent-tool-parity.mjs --live",
    "gen-lists-manifest.mjs --check",
    // The Bazaar snapshot's source lives on the ops volume, so this one runs only where that volume is mounted and
    // exits 2 (not silently green) when it is not — GitHub's checkout has no /work/ops, so it stays out of ci.yml.
    "gen-bazaar-demand.mjs --check",
    // Same mount rule as the Bazaar snapshot: the research record is on the ops volume and exits 2 when absent.
    "gen-checked-sellers.mjs --check",
    "check-drainer-citations.mjs",
    "check-provenance-table.mjs",
    "check-examples.mjs",
    "check-listing-tools.mjs",
    "gen-integrations.mjs --check",
    "check-integrations-grading.mjs",
    "gen-verified-payees.mjs --check",
    "gen-build-info.mjs --check",
    "check-copy.mjs",
    // #457: the kit is part of the build, so the cold run checks it too, not just the fast pass. check-brand-assets
    // also enforces the asset ledger, so a clean checkout with stale generated bytes is red here.
    "check-pass-assets.mjs",
    "check-brand-assets.mjs",
    "check-brand-commands.mjs",
    "check-mocks-index.mjs",
    "check-soak-mesh.mjs",
    "check-doc-links.mjs",
    "check-published-links.mjs",
    "check-badges.mjs",
    "check-canary-badge.mjs",
    "check-tarballs.mjs",
    "check-count-claims.mjs",
    "check-network-claims.mjs",
    "check-sanctions-live.mjs",
    "check-receipt-live.mjs",
    "check-repo-depth.mjs",
    "check-mcp-live.mjs",
    "check-manifests.mjs",
    "check-changelog.mjs",
    "check-version-parity.mjs",
    "check-client-id.mjs",
    "check-env-vars.mjs",
    "check-route-styles.mjs",
    "check-route-docs.mjs",
    "check-openapi-parity.mjs",
    "check-directory.mjs",
    /* #490: the pricing page's "has anyone paid us" sentence must be the committed classifier snapshot, every transfer
       must be classified against the published list, and the last-external date must be derived, not typed. */
    "check-payments-incoming.mjs",
    "check-unit-economics.mjs",
    "check-relative-imports.mjs",
    "check-migrations-private.mjs",
    "check-tests-read-tracked.mjs",
    "check-workspace-pins.mjs",
    "check-workflows.mjs",
    "check-script-bins.mjs",
    "check-hosted-deps.mjs",
    "check-i18n-discovery.mjs",
    "check-titles.mjs",
    "check-fail-closed.mjs",
    "check-client-env.mjs",
    "check-deps-budget.mjs",
    "check-pypi-package.mjs",
    "check-registry-namespace.mjs --accept-retired",
  ]) {
    const [script, ...scriptArgs] = check.split(" ");
    if (!existsSync(join(worktree, "scripts", script))) continue;
    run(check, "node", [join("scripts", script), ...scriptArgs], worktree);
  }

  // Advisory: needs Base's RPC, so it reports but never sets `failed`. See runAdvisory.
  if (existsSync(join(worktree, "scripts/check-facilitator-gas.mjs"))) {
    runAdvisory(
      "check-facilitator-gas",
      "node",
      [join(worktree, "scripts", "check-facilitator-gas.mjs")],
      worktree,
    );
  }
} catch (error) {
  failed = true;
  console.error(`ci-local: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try {
    git(["worktree", "remove", "--force", worktree]);
  } catch {
    rmSync(worktree, { recursive: true, force: true });
  }
}

if (failed) {
  console.error("\nci-local: CI would fail on this commit. Fix it here, or push with --no-verify and say why.");
  process.exit(1);
}
console.log("\nci-local: clean install, build, tests and checks all pass — CI should go green.");
process.exit(0);
