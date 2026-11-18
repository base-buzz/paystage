#!/usr/bin/env node
/**
 * The client id an SDK sends must match its own package version (#52).
 *
 * Attribution only works if the header is right, and a hand-written constant drifts the moment someone bumps a version.
 * This is the guard that makes the constant safe: the header and the manifest are compared, and a mismatch fails CI.
 *
 *   node scripts/check-client-id.mjs
 *
 * Exit 0 every declared client id matches its manifest · 1 a mismatch · 2 cannot read.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["mcp", "x402-guard", "ai-sdk"];

const problems = [];
let checked = 0;

for (const pkg of PACKAGES) {
  const manifestPath = join(ROOT, "packages", pkg, "package.json");
  const sourcePath = join(ROOT, "packages", pkg, "src/tools.ts");
  if (!existsSync(manifestPath)) {
    problems.push(`${pkg}: no package.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!existsSync(sourcePath)) continue; // this package does not declare a client id yet

  const source = readFileSync(sourcePath, "utf8");
  const id = /export const CLIENT_ID = `\$\{[^}]+\}\/([^`]+)`/.exec(source)?.[1];
  if (id === undefined) continue; // nothing declared, nothing to check
  checked += 1;
  if (id !== manifest.version) {
    problems.push(`${manifest.name}: CLIENT_ID says ${id}, package.json says ${manifest.version}`);
  }
  if (!source.includes("x-paystage-client")) {
    problems.push(`${manifest.name}: declares CLIENT_ID but never sends it as x-paystage-client`);
  }
}

if (problems.length === 0) {
  console.log(`client-id: ${checked} declared client id(s) match their manifest`);
  process.exit(0);
}
console.error("client-id: attribution would be wrong in these packages:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
