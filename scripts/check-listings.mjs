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
    kind: "html",
  },
  {
    name: "mcp-registry",
    // The official registry is what MCP clients actually resolve against, so a stale
    // version here is worse than anywhere else: it is authoritative to the tooling.
    url: "https://registry.modelcontextprotocol.io/v0/servers?search=xyz.paystage",
    kind: "mcp-registry",
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

/** Highest version among the entries for one server name, compared numerically. */
function highest(entries) {
  const cmp = (a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i += 1) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
  };
  return entries.sort(cmp).at(-1);
}

async function checkMcpRegistry(listing, want) {
  let res;
  try {
    res = await fetch(listing.url, {
      headers: { "user-agent": "PayStageListingCheck/1.0 (+https://paystage.xyz)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { name: listing.name, url: listing.url, ok: false, reason: error instanceof Error ? error.name : "error" };
  }
  // A 403 from a bot-protected directory is not evidence of drift — GitHub's runners
  // come from datacenter ranges these sites block. Reporting "cannot check" as
  // "out of date" would train everyone to ignore the alert.
  if (res.status === 403 || res.status === 429) {
    return {
      name: listing.name,
      url: listing.url,
      ok: true,
      unverifiable: true,
      reason: `HTTP ${res.status} — the site blocks this network, so the listing could not be read`,
    };
  }
  if (!res.ok) return { name: listing.name, url: listing.url, ok: false, reason: `HTTP ${res.status}` };

  const body = await res.json();
  const servers = Array.isArray(body.servers) ? body.servers : [];
  if (servers.length === 0) {
    return { name: listing.name, url: listing.url, ok: false, reason: "no entries for xyz.paystage" };
  }

  // The registry keeps every version ever published, so only the highest per name is
  // "what a client resolves". Comparing every historical entry would fail forever.
  const latest = new Map();
  for (const entry of servers) {
    const server = entry.server ?? entry;
    const name = String(server.name ?? "");
    if (name === "") continue;
    const version = String(server.version ?? "0");
    latest.set(name, highest([latest.get(name), version].filter(Boolean)));
  }

  const stale = [];
  for (const [name, published] of latest) {
    const pkg = name.split("/")[1];
    if (!pkg) continue;
    let localVersion;
    try {
      localVersion = JSON.parse(await readFile(new URL(`../packages/${pkg}/server.json`, import.meta.url), "utf8")).version;
    } catch {
      continue;
    }
    if (published !== localVersion) {
      stale.push(`${name} published ${published}, repo ${localVersion}`);
    }
  }

  // A server missing entirely is a different failure from one lagging behind.
  const publishedNames = new Set(servers.map((e) => String((e.server ?? e).name ?? "")));
  for (const pkg of want.packages.filter((p) => p !== "@paystage/policy")) {
    const name = `xyz.paystage/${pkg.replace("@paystage/", "")}`;
    if (!publishedNames.has(name) && pkg === "@paystage/mcp") {
      stale.push(`${name} is not published at all`);
    }
  }

  return {
    name: listing.name,
    url: listing.url,
    ok: stale.length === 0,
    entries: servers.length,
    ...(stale.length === 0 ? {} : { reason: `stale: ${stale.join("; ")}`, stale }),
  };
}

async function checkListing(listing, want) {
  if (listing.kind === "mcp-registry") return checkMcpRegistry(listing, want);
  let res;
  try {
    res = await fetch(listing.url, {
      headers: { "user-agent": "PayStageListingCheck/1.0 (+https://paystage.xyz)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { name: listing.name, url: listing.url, ok: false, reason: error instanceof Error ? error.name : "error" };
  }
  // A 403 from a bot-protected directory is not evidence of drift — GitHub's runners
  // come from datacenter ranges these sites block. Reporting "cannot check" as
  // "out of date" would train everyone to ignore the alert.
  if (res.status === 403 || res.status === 429) {
    return {
      name: listing.name,
      url: listing.url,
      ok: true,
      unverifiable: true,
      reason: `HTTP ${res.status} — the site blocks this network, so the listing could not be read`,
    };
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
    const detail = r.ok
      ? r.entries === undefined
        ? `${r.expected_tools} tools present`
        : `${r.entries} entries, all at the repo version`
      : r.reason;
    const mark = r.unverifiable ? "skip" : r.ok ? "ok  " : "DRIFT";
    process.stdout.write(`${mark} ${r.name.padEnd(12)} ${r.unverifiable ? r.reason : detail}\n`);
  }
  const drift = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.unverifiable);
  process.stdout.write(
    `\n${results.length - drift.length}/${results.length} listings fine` +
      (skipped.length > 0 ? ` (${skipped.length} not readable from here)` : "") +
      "\n",
  );
}

process.exit(summary.ok ? 0 : 1);
