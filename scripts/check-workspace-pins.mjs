#!/usr/bin/env node
/**
 * An exact pin on a workspace package must match that package's version (#505).
 *
 * A release attempt failed at exactly this: `@paystage/mcp` was bumped to 0.8.19 while
 * `packages/x402-guard/package.json` still pinned `"@paystage/preflight": "0.6.0"` — an exact version that no longer existed in the
 * tree. `npm ci` then refused to install, and the failure surfaced as "lockfile out of sync", which is the wrong place to look.
 *
 * Ranges (`^0.6.0`, `~0.6.0`, `*`) are exempt: they express compatibility and resolve to whatever the workspace provides. Only
 * **exact** pins are checked, because only an exact pin can name a version that does not exist.
 *
 * Exit 0 all exact pins match · 10 a pin disagrees · 11 a workspace manifest cannot be read.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const WORKSPACES = "packages";
const versions = new Map();
const problems = [];

const dirs = existsSync(WORKSPACES) ? readdirSync(WORKSPACES, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
for (const dir of dirs) {
  const manifest = join(WORKSPACES, dir.name, "package.json");
  if (!existsSync(manifest)) continue;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (error) {
    console.error(`workspace-pins: ${manifest} is not readable JSON (${error instanceof Error ? error.message : String(error)})`);
    process.exit(11);
  }
  if (typeof pkg.name === "string" && typeof pkg.version === "string") versions.set(pkg.name, { version: pkg.version, path: manifest });
}

if (versions.size === 0) {
  console.error(`workspace-pins: found no workspace packages under ${WORKSPACES} — the scan is wrong, not the pins`);
  process.exit(11);
}

/** Every manifest that can hold a dependency, including the root. */
const manifests = ["package.json", ...dirs.map((d) => join(WORKSPACES, d.name, "package.json")).filter(existsSync)];
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

let checked = 0;
for (const manifest of manifests) {
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  for (const field of FIELDS) {
    for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
      const workspace = versions.get(dep);
      if (!workspace) continue;
      // Only an exact version string is a pin; anything with a range operator resolves through the workspace.
      if (!/^\d+\.\d+\.\d+/.test(String(spec))) continue;
      checked += 1;
      if (spec !== workspace.version) {
        problems.push(
          `${manifest}: ${field}.${dep} is pinned to "${spec}" but ${workspace.path} is ${workspace.version} — ` +
            `an exact pin on a version that does not exist makes npm ci refuse the whole tree`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`workspace-pins: ${problems.length} pin(s) disagree with the workspace`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(10);
}
console.log(`workspace-pins: ${checked} exact pin(s) across ${manifests.length} manifest(s) match their workspace versions`);
