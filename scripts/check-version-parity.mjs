#!/usr/bin/env node
/**
 * One version, stated in several files, is one version too many (#137).
 *
 * The registry check failed on 2026-11-09 with "npm 0.3.0 vs manifest 0.3.1" a day **after** the release, because a
 * bump touched `package.json` and not `server.json`. The publish was fine; the artifact that describes it was wrong,
 * and nobody noticed until a checker downstream did.
 *
 *   node scripts/check-version-parity.mjs
 *
 * Exit 0 every declared version agrees · 1 a disagreement · 2 cannot read.
 *
 * Also checks `toolCount` where a package declares it, because that is the same class of drift and it has now cost
 * four separate fixes in one day.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
let checked = 0;

const packagesDir = join(ROOT, "packages");
for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const base = join(packagesDir, dir.name);
  const manifestPath = join(base, "package.json");
  const serverPath = join(base, "server.json");
  if (!existsSync(manifestPath)) continue;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.private) continue;

  if (existsSync(serverPath)) {
    const server = JSON.parse(readFileSync(serverPath, "utf8"));
    checked += 1;
    if (server.version !== manifest.version) {
      problems.push(
        `${manifest.name}: server.json says ${server.version}, package.json says ${manifest.version} — bump both, or the registry entry describes a version nobody can install`,
      );
    }
    /**
     * A server.json that names a package at a pinned version must pin the same one — and the schema puts that version in a **separate field**, not in the identifier.
     *
     * This read only `identifier` for an `@x.y.z` suffix, which our files never contain (`identifier: "@paystage/preflight"`, `version: "0.2.3"`), so `pinned` was always undefined and the
     * check skipped every package. It reported "6 declaration(s) agree" while `packages/preflight/server.json` pinned 0.2.3 against a 0.5.3 manifest — correct by luck for mcp, stale for
     * preflight since at least two releases. Found 2026-11-20 by a peer reading the file rather than the output.
     */
    for (const pkg of server.packages ?? []) {
      const fromField = typeof pkg.version === "string" ? pkg.version : undefined;
      const fromIdentifier = /@(\d+\.\d+\.\d+)/.exec(String(pkg.identifier ?? ""))?.[1];
      const pinned = fromField ?? fromIdentifier;
      if (pinned !== undefined && pinned !== manifest.version) {
        problems.push(`${manifest.name}: server.json pins ${pkg.identifier}@${pinned}, package.json says ${manifest.version}`);
      }
    }
  }
}

// The umbrella package states a tool count in several places. Derive it from the registry and compare.
const toolsPath = join(packagesDir, "mcp/src/tools.ts");
if (existsSync(toolsPath)) {
  const source = readFileSync(toolsPath, "utf8");
  const names = /export const TOOL_NAMES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? "";
  const count = (names.match(/"[a-z0-9_]+"/g) ?? []).length;
  checked += 1;

  const consoleTools = join(ROOT, "apps/console/src/lib/tools.ts");
  if (existsSync(consoleTools)) {
    const declared = Number(/export const TOOL_COUNT = (\d+)/.exec(readFileSync(consoleTools, "utf8"))?.[1]);
    if (Number.isFinite(declared) && declared !== count) {
      problems.push(`apps/console/src/lib/tools.ts says TOOL_COUNT = ${declared}, the package registers ${count}`);
    }
  }
}

if (problems.length === 0) {
  console.log(`version-parity: ${checked} declaration(s) agree`);
  process.exit(0);
}
console.error("version-parity: these declarations disagree:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
