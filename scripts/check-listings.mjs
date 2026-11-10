#!/usr/bin/env node
/**
 * Check third-party listings against what we actually publish.
 *
 * mcp.so, Glama and the MCP registry are how people find this without npm search.
 * Each is a snapshot taken when the listing was submitted, and none of them notice
 * when we add a tool or rename one — so a months-old page keeps advertising five
 * tools to anyone arriving that way.
 *
 * This is deliberately a *substring* check, not a DOM scrape: the pages are rendered
 * differently every few months, and a parser that breaks silently is worse than a
 * crude check that fails loudly. A missing tool name is a real signal; a changed
 * class name is not.
 *
 *   node scripts/check-listings.mjs          # human-readable
 *   node scripts/check-listings.mjs --json   # machine-readable
 *
 * Exit codes: 0 in sync · 1 drift or unreachable.
 */

import { readFile } from "node:fs/promises";

const MANIFEST_URL = new URL("../apps/console/src/lib/agent-manifest.ts", import.meta.url);

const LISTINGS = [
  {
    name: "mcp.so",
    url: "https://mcp.so/servers/paystage-6d8a8f",
    // No version number is published there, so the tool names are the whole signal.
    requires: "tools-and-install",
  },
];

const TIMEOUT_MS = 15_000;
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");

/** Tool names and the install command, read from the manifest so they cannot drift. */
async function expected() {
  const source = await readFile(MANIFEST_URL, "utf8");
  const tools = [...source.matchAll(/name:\s*"([a-z0-9_]+)"/g)]
    .map((m) => m[1])
    .filter((n) => n.startsWith("evaluate_") || n.startsWith("list_"));
  const pkg = [...source.matchAll(/"(@paystage\/[a-z-]+)"/g)].map((m) => m[1]);
  return { tools: [...new Set(tools)], packages: [...new Set(pkg)] };
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

async function checkListing(listing, want) {
  let res;
  try {
    res = await fetch(listing.url, {
      headers: { "user-agent": "PayStageListingCheck/1.0 (+https://paystage.xyz)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { name: listing.name, url: listing.url, ok: false, reason: error instanceof Error ? error.name : "error" };
  }
  if (!res.ok) return { name: listing.name, url: listing.url, ok: false, reason: `HTTP ${res.status}` };

  const text = stripTags(await res.text());
  const missing = [];

  for (const tool of want.tools) if (!text.includes(tool)) missing.push(tool);
  const install = `npx -y @paystage/mcp`;
  if (!text.includes(install) && !text.includes(`@paystage/mcp`)) missing.push("install command");

  return {
    name: listing.name,
    url: listing.url,
    ok: missing.length === 0,
    expected_tools: want.tools.length,
    missing,
    ...(missing.length === 0 ? {} : { reason: `listing is out of date: missing ${missing.join(", ")}` }),
  };
}

const want = await expected();
const results = [];
for (const listing of LISTINGS) results.push(await checkListing(listing, want));

const summary = {
  checked_at: new Date().toISOString(),
  expected_tools: want.tools,
  listings: results,
  ok: results.every((r) => r.ok),
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  for (const r of results) {
    process.stdout.write(`${r.ok ? "ok  " : "DRIFT"} ${r.name.padEnd(10)} ${r.ok ? `${r.expected_tools} tools present` : r.reason}\n`);
  }
  process.stdout.write(`\n${results.filter((r) => r.ok).length}/${results.length} listings in sync\n`);
}

process.exit(summary.ok ? 0 : 1);
