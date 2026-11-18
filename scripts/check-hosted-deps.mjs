#!/usr/bin/env node
/**
 * `apps/hosted` sits outside the npm workspace, and that has to be visible (#119).
 *
 * The app declares `@paystage/*` dependencies as `file:../../packages/…` and carries **its own** lockfile, so a new
 * workspace package needs a manual lockfile refresh — and the failure only appears in the deploy job, where the build
 * cannot resolve the import and the error reads like a code bug rather than a stale lockfile.
 *
 *   node scripts/check-hosted-deps.mjs
 *
 * Exit 0 every declaration resolves · 1 one does not · 2 cannot read.
 *
 * Two failures it catches:
 *  - a `file:` path that does not exist (a rename, a moved package);
 *  - a `@paystage/*` dependency missing from `apps/hosted/package-lock.json`, which is what a fresh `npm ci` in the
 *    deploy job will refuse.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOSTED = join(ROOT, "apps/hosted");

const manifestPath = join(HOSTED, "package.json");
if (!existsSync(manifestPath)) {
  console.error("hosted-deps: apps/hosted/package.json not found");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const lockPath = join(HOSTED, "package-lock.json");
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;

const problems = [];
let checked = 0;

for (const field of ["dependencies", "devDependencies"]) {
  for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
    if (!name.startsWith("@paystage/")) continue;
    checked += 1;

    if (typeof spec === "string" && spec.startsWith("file:")) {
      const target = resolve(HOSTED, spec.slice("file:".length));
      if (!existsSync(join(target, "package.json"))) {
        problems.push(`${name}: "${spec}" points at ${target.replace(`${ROOT}/`, "")}, which has no package.json`);
        continue;
      }
      // The resolved package must be the name we asked for: a `file:` path to the wrong package is a rename nobody
      // noticed.
      const resolved = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
      if (resolved.name !== name) {
        problems.push(`${name}: "${spec}" resolves to a package named ${resolved.name}`);
      }
    }

    // The deploy job runs `npm ci` in this directory, which requires the lockfile to know the dependency.
    if (lock !== null) {
      const inLock = Object.keys(lock.packages ?? {}).some(
        (key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`),
      );
      if (!inLock) {
        problems.push(
          `${name} is declared in apps/hosted/package.json but absent from apps/hosted/package-lock.json — run \`npm install\` in apps/hosted, or the deploy fails with an unresolved import`,
        );
      }
    }
  }
}

if (lock === null) {
  console.warn("hosted-deps: apps/hosted/package-lock.json is missing — the deploy job cannot run `npm ci`");
}

if (problems.length === 0) {
  console.log(`hosted-deps: ${checked} @paystage dependenc(ies) resolve and are in the lockfile`);
  process.exit(0);
}
console.error("hosted-deps: apps/hosted is outside the workspace, so these do not resolve by themselves:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
