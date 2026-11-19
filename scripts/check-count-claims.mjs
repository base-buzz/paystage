#!/usr/bin/env node
/**
 * A count in prose is a claim, and prose does not compile.
 *
 * "ten packages and ten tools" was true when it was written and became false the moment two framework packages were added — nothing
 * checks markdown numbers, so it silently understated the project. The tool count is guarded by a test; this guards the prose.
 *
 *   node scripts/check-count-claims.mjs
 *
 * Exit 0 every count matches · 10 one does not.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from the script, never hardcoded: CI checks out to a different path, and a hardcoded root passed locally and failed there.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
};

const manifest = readFileSync(`${ROOT}/apps/console/src/lib/agent-manifest.ts`, "utf8");
const packages = new Set([...manifest.matchAll(/"(@paystage\/[a-z0-9-]+)":/g)].map((m) => m[1])).size;

// The tool list is the single source of truth the MCP package exports.
const toolsSource = readFileSync(`${ROOT}/packages/mcp/src/tools.ts`, "utf8");
const toolList = /export const TOOL_NAMES = \[([\s\S]*?)\];/.exec(toolsSource)?.[1] ?? "";
const tools = new Set([...toolList.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1])).size;

import { readdirSync } from "node:fs";

/**
 * Package descriptions are prose too, and npm shows them before anything else.
 *
 * `@paystage/mcp` said "nine MCP tools" for as long as it had ten — the count had been fixed in the README and the manifest, and the description, which is the one a
 * searcher reads first, was never in the scan.
 */
const PACKAGE_DESCRIPTIONS = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => `packages/${d.name}/package.json`)
  .filter((f) => existsSync(join(ROOT, f)));

const FILES = [
  "README.md",
  "apps/console/src/app/page.tsx",
  "apps/console/src/app/llms.txt/route.ts",
  "apps/console/src/app/llms-full.txt/route.ts",
  ...PACKAGE_DESCRIPTIONS,
];

const CLAIM = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\s+(MCP\s+)?(tools|packages)\b/gi;
const problems = [];
let checked = 0;

for (const file of FILES) {
  const text = readFileSync(`${ROOT}/${file}`, "utf8");
  for (const match of text.matchAll(CLAIM)) {
    const raw = match[1].toLowerCase();
    const value = /^\d+$/.test(raw) ? Number(raw) : WORDS[raw];
    if (!value) continue;
    const kind = match[3].toLowerCase();
    const actual = kind === "tools" ? tools : packages;
    checked += 1;
    if (value !== actual) problems.push(`${file}: says ${match[1]} ${match[3]}, there are ${actual}`);
  }
}

for (const p of problems) console.error(`  FAIL ${p}`);
console.log(
  problems.length === 0
    ? `count-claims: ${checked} count(s) checked against ${tools} tools and ${packages} packages`
    : `count-claims: ${problems.length} of ${checked} wrong`,
);
process.exit(problems.length === 0 ? 0 : 10);
