#!/usr/bin/env node
/**
 * Every workspace package must declare what it ships.
 *
 * @paystage/mcp compiled dist/index.js and dist/index.d.ts and declared neither, so a
 * TypeScript consumer importing it got no types at all — while five sibling packages did
 * it correctly. This catches the class, not the instance.
 *
 *   node scripts/check-manifests.mjs        # exits 1 on any undeclared build output
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname;
const problems = [];
const checked = [];

const dirs = readdirSync(`${ROOT}packages`, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const dir of dirs) {
  const manifestPath = `${ROOT}packages/${dir}/package.json`;
  if (!existsSync(manifestPath)) continue;
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dist = `${ROOT}packages/${dir}/dist`;
  const hasDist = existsSync(dist);
  const dts = hasDist && readdirSync(dist).some((f) => f.endsWith(".d.ts"));
  const entry = hasDist && existsSync(`${dist}index.js`);
  checked.push(m.name);

  if (!dts) continue; // nothing to declare

  if (entry && !m.main) problems.push(`${m.name}: ships dist/index.js but declares no "main"`);
  if (!m.types && !m.typings) {
    problems.push(`${m.name}: ships .d.ts files but declares no "types" — importers get no types`);
  }
  if (entry && !m.exports) {
    problems.push(`${m.name}: declares no "exports" map — resolution falls back to legacy main`);
  }
}

if (problems.length === 0) {
  console.log(`manifests ok: ${checked.length} packages declare what they ship`);
  process.exit(0);
}

console.error("package manifest problems:");
for (const p of problems) console.error(`  · ${p}`);
process.exit(1);
