#!/usr/bin/env node
/**
 * Our registry listing must name the tools we actually ship.
 *
 *   node scripts/check-listing-tools.mjs
 *
 * Exit 0 every shipped tool is named in `registry/services.json` · 1 one is missing · 2 the listing or the server source is unreadable.
 *
 * Why, 2026-11-22: a bot browsing the catalogue sees one URL and a sentence. We are 1 entry in ~40,157, and the entry named no tools at all — so an agent could not
 * tell that ten of them sit behind the endpoint. A listing that drifts from the code is worse than a short one, because it is a claim a stranger will check.
 */
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
let src, listing;
try {
  src = readFileSync(`${ROOT}packages/mcp/src/tools.ts`, "utf8");
  listing = readFileSync(`${ROOT}registry/services.json`, "utf8");
} catch (error) {
  console.error(`listing-tools: cannot read a source — ${String(error.message).slice(0, 80)}`);
  process.exit(2);
}

const tools = [...new Set([...src.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
if (tools.length === 0) {
  console.error("listing-tools: the server source parsed to zero tools — check the pattern before trusting this");
  process.exit(2);
}
const entries = JSON.parse(listing);
const ours = entries.find((e) => String(e.url ?? "").includes("api.paystage.xyz"));
if (!ours) {
  console.error("listing-tools: no entry for api.paystage.xyz in registry/services.json");
  process.exit(2);
}

const missing = tools.filter((t) => !String(ours.description ?? "").includes(t));
if (missing.length > 0) {
  console.error(`listing-tools: ${missing.length} shipped tool(s) missing from the listing — ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`listing-tools: ok — all ${tools.length} shipped tools are named in the registry entry`);
