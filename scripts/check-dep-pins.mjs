#!/usr/bin/env node
/**
 * Internal dependency pins must match the workspace version.
 *
 * `@paystage/mcp` pinned `@paystage/preflight: "0.3.0"` while the workspace was on 0.5.0, so `npx @paystage/mcp` installed an
 * evaluator missing the malformed-payee rule and time windows — the published path was weaker than the repo, and nothing
 * failed. Exact pins are good; exact pins to a stale version are a silent downgrade for every user.
 *
 *   node scripts/check-dep-pins.mjs
 *
 * ...and the pin is not the whole story. A **vendored copy** of a sibling inside a package's own
 * `node_modules` shadows the workspace symlink, so a package's tests run against whatever version got
 * copied there once. On 2026-11-17 `packages/x402-guard/node_modules/@paystage/preflight` held **0.3.0**
 * while the pin said 0.5.0 — every guard test was asserting against an evaluator two minors behind, and
 * the pin check passed. Same silent downgrade, one layer lower, so it gets the same treatment.
 *
 * Exit 0 clean · 1 a stale pin or a shadowing copy.
 */
import { readFileSync, readdirSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PKGS = join(ROOT, "packages");
const versions = new Map();
for (const dir of readdirSync(PKGS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const manifest = join(PKGS, dir.name, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.name) versions.set(pkg.name, pkg.version);
}

const problems = [];
const warnings = [];
for (const [name, version] of versions) {
  const dir = readdirSync(PKGS, { withFileTypes: true }).find((d) => {
    const m = join(PKGS, d.name, "package.json");
    return existsSync(m) && JSON.parse(readFileSync(m, "utf8")).name === name;
  });
  if (!dir) continue;
  const pkg = JSON.parse(readFileSync(join(PKGS, dir.name, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (!versions.has(dep)) continue;
      const want = versions.get(dep);
      /**
       * An exact pin must equal the workspace version; a caret or tilde may satisfy it.
       *
       * Strict equality on every range turned a patch bump of the evaluator into four package releases — the cascade
       * that produced this very file's first two findings. A `^0.5.0` that the workspace satisfies is not drift; an
       * exact `0.5.0` when the workspace is 0.5.2 is, because every user of that package gets the older evaluator.
       */
      const satisfied = (() => {
        if (range === want) return true;
        const m = /^[\^~](\d+)\.(\d+)\.(\d+)/.exec(range);
        if (!m) return false;
        const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const [wmaj, wmin, wpat] = want.split(".").map(Number);
        if (range.startsWith("^")) return wmaj === maj && (wmin > min || (wmin === min && wpat >= pat));
        return wmaj === maj && wmin === min && wpat >= pat; // `~` allows patch-level
      })();
      if (!satisfied) problems.push(`${name} → ${dep}: "${range}" but the workspace has ${want}`);
    }
  }
}

/**
 * A sibling installed *inside* a package shadows the workspace link for that package only. Symlinks are
 * what npm workspaces make; a real directory is a leftover, and it silently pins that package's tests.
 */
function checkShadowingCopies() {
  const scopes = [];
  for (const tree of ["packages", "apps"]) {
    const base = join(ROOT, tree);
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      scopes.push(join(base, dir.name, "node_modules", "@paystage"));
    }
  }
  for (const scope of scopes) {
    if (!existsSync(scope)) continue;
    for (const entry of readdirSync(scope, { withFileTypes: true })) {
      const path = join(scope, entry.name);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      const name = `@paystage/${entry.name}`;
      const expected = versions.get(name);
      if (!expected) continue;
      let installed = "unknown";
      try {
        installed = JSON.parse(readFileSync(join(path, "package.json"), "utf8")).version;
      } catch {
        /* a copy with no readable manifest is still a copy */
      }
      // A copy at the right version is untidy; a copy at a different version means this package's tests are
      // asserting against something the pin does not describe, which is the failure the pin check exists for.
      const shadowDesc = `${path.replace(ROOT, "")} is a vendored copy (${installed}), not a workspace link to ${expected}`;
      if (installed !== expected) problems.push(`${shadowDesc} — this package's tests are asserting against the wrong sibling`);
      else warnings.push(shadowDesc);
    }
  }
}

checkShadowingCopies();

for (const w of warnings) console.warn(`  warn  ${w}`);
if (problems.length === 0) {
  console.log(`dep-pins: all ${versions.size} internal pins match the workspace${warnings.length ? ` (${warnings.length} same-version copy/copies, harmless)` : ""}`);
  process.exit(0);
}
console.error(`dep-pins: ${problems.length} problem(s) — a stale pin, or a vendored sibling that shadows the workspace (so tests assert against it):`);
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
