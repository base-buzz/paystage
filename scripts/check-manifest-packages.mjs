#!/usr/bin/env node
/**
 * `/agent-manifest.json` must name every published package.
 *
 * `PACKAGE_VERSIONS` listed six of ten: `x402-guard`, `skill`, `ai-sdk` and `x-evm` were missing, so the manifest — the
 * surface built specifically for agents — could not name the guard. The existing test pinned the six versions and never
 * asserted the set, which is the same shape as "the site claimed nine tools and the endpoint served one": a test that
 * checks the values that exist, not that all of them do.
 *
 *   node scripts/check-manifest-packages.mjs
 *
 * Exit 0 clean · 1 a published package the manifest does not know about.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const manifestPath = join(ROOT, "apps/console/src/lib/agent-manifest.ts");
const source = readFileSync(manifestPath, "utf8");

const block = /export const PACKAGE_VERSIONS[^{]*\{([\s\S]*?)\}/.exec(source)?.[1] ?? "";
const named = new Set([...block.matchAll(/"(@paystage\/[a-z0-9-]+)":/g)].map((m) => m[1]));

const published = [];
for (const dir of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = join(ROOT, "packages", dir.name, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (!pkg.private && pkg.name?.startsWith("@paystage/")) published.push(pkg.name);
}

const missing = published.filter((name) => !named.has(name));
if (missing.length === 0) {
  console.log(`manifest-packages: all ${published.length} published packages are named`);
  process.exit(0);
}
console.error(`manifest-packages: ${missing.length} published package(s) missing from PACKAGE_VERSIONS:`);
for (const name of missing) console.error(`  ${name}`);
process.exit(1);
