#!/usr/bin/env node
/**
 * The description npm shows must match the description in the repo.
 *
 * Round 112 fixed "nine MCP tools" to "ten" in `packages/mcp/package.json` — and npm kept serving "nine", because a description is frozen at publish time. Nothing said so:
 * the repo was right, the published surface was wrong, and the only way to notice was to ask npm.
 *
 *   node scripts/check-npm-description.mjs
 *
 * Exit 0 the published description matches this commit · 10 it does not (a release is pending) · 11 npm could not be read.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "@paystage/mcp";
const local = JSON.parse(readFileSync(join(ROOT, "packages/mcp/package.json"), "utf8")).description;

let published;
try {
  published = execFileSync("npm", ["view", PKG, "description"], { encoding: "utf8", timeout: 60_000 }).trim();
} catch (error) {
  console.error(`npm-description: could not read npm — ${String(error).slice(0, 80)}`);
  process.exit(11);
}

if (published !== local) {
  const firstDifference = [...local].findIndex((c, i) => c !== published[i]);
  console.error(`npm-description: npm serves a different description than this commit (first difference at character ${firstDifference})`);
  console.error(`  npm:   ${published.slice(0, 120)}`);
  console.error(`  local: ${local.slice(0, 120)}`);
  console.error("  A description is frozen at publish time — this resolves at the next release, not by editing again.");
  process.exit(10);
}
console.log(`npm-description: ${PKG} matches this commit`);
