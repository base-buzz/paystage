#!/usr/bin/env node
/**
 * Listing freshness: does each distribution surface still describe the server we ship?
 *
 * The site said nine tools while mcp.so listed one, and nothing noticed. Every directory is a copy of
 * a copy, and the copies do not update themselves in step — some crawl our README, some are manual,
 * some are a PR nobody merged yet.
 *
 *   node scripts/check-listings.mjs            # report
 *   node scripts/check-listings.mjs --json
 *
 * It can only DETECT. Which of these we can push ourselves is in the output per entry, because
 * "stale" and "fixable by us" are different facts and conflating them wastes a cycle.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function expectedTools() {
  const src = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
  const block = src.slice(src.indexOf("export const TOOL_NAMES"), src.indexOf("] as const", src.indexOf("export const TOOL_NAMES")));
  return [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

const tools = expectedTools();

/**
 * The inventory is the source of truth: `ops/docs/state/distribution.json`.
 *
 * A hardcoded list here meant the checker and the record could disagree — the checker would pass
 * while a surface we had forgotten about stayed stale. It now reads the inventory, so adding a
 * surface is a data edit and forgetting one shows up as a missing row rather than as silence.
 */
const INVENTORY = process.env.PAYSTAGE_DISTRIBUTION ?? '/work/ops/docs/state/distribution.json';

function loadInventory() {
  try {
    const raw = readFileSync(INVENTORY, 'utf8');
    return JSON.parse(raw).surfaces ?? [];
  } catch {
    return null;
  }
}

/**
 * Surfaces we can read anonymously.
 *
 * `mode` is the point. A tool-name grep is only meaningful where the surface lists tool names.
 * The npm registry documents and the MCP registry's search payload do not, so grepping them produced
 * "0/9" on the first run — a false positive that would have sent someone to republish a package that
 * was already correct. Those surfaces are checked for version alignment instead.
 */
const SURFACES = [
  { name: "npm @paystage/mcp", url: "https://registry.npmjs.org/@paystage%2Fmcp/latest", mode: "json-version", owner: "us — publish a version" },
  { name: "MCP registry (remote entry)", url: "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.base-buzz", mode: "json-version", owner: "us — mcp-publisher" },
  { name: "mcp.so", url: "https://mcp.so/servers/paystage-6d8a8f", mode: "names", owner: "them — /submit, or wait for a crawl" },
  { name: "Glama", url: "https://glama.ai/mcp/servers/base-buzz/paystage", mode: "names", owner: "them — crawls the registry" },
  { name: "GitHub README", url: "https://raw.githubusercontent.com/base-buzz/paystage/main/README.md", mode: "names", owner: "us — commit" },
];

async function fetchText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "PayStage-listing-check/1.0" } });
    if (!res.ok) return { text: null, status: res.status };
    return { text: await res.text(), status: res.status };
  } catch (err) {
    return { text: null, status: String(err.message ?? err).slice(0, 60) };
  }
}

const inventory = loadInventory();
const fromInventory = (inventory ?? [])
  .filter((s) => s.probe && s.probe.type !== "none" && s.url)
  .map((s) => ({
    name: s.name,
    url: s.url,
    mode:
      s.probe.type === "names" ? "names"
      : s.probe.type === "npm-version" ? "json-version"
      : s.probe.type === "pr" ? "pr"
      : "http",
    pr: s.probe.type === "pr" ? s.probe : undefined,
    owner: s.owner === "us" ? "us" : s.owner === "operator" ? "the operator" : "them",
    state: s.state,
  }));

const rows = [];
for (const surface of (fromInventory.length > 0 ? fromInventory : SURFACES)) {
  const { text, status } = await fetchText(surface.url);
  if (text === null) {
    rows.push({ ...surface, found: null, status, note: "unreadable" });
    continue;
  }
  if (surface.mode === "pr") {
    // A pull request is not a listing: grepping its page for tool names measured the wrong thing and
    // reported twelve stale rows that were simply open PRs awaiting review. The meaningful state is
    // whether it is still open.
    let state = null;
    try {
      const out = execFileSync("gh", ["api", `repos/${surface.pr.repo}/pulls/${surface.pr.number}`, "--jq", ".state"], {
        encoding: "utf8", timeout: 30_000,
      }).trim();
      state = out;
    } catch (err) {
      rows.push({ ...surface, found: null, status: "unreadable", note: String(err).slice(0, 60) });
      continue;
    }
    const merged = state === "closed" ? "closed-or-merged" : state.toLowerCase();
    rows.push({
      ...surface,
      found: state === "open" ? tools.length : 0,
      status: state,
      note: `PR ${merged} (#${surface.pr.number})`,
    });
    continue;
  }

  if (surface.mode === "json-version") {
    // Version alignment only: these payloads do not carry tool names, so a name count here would be
    // measuring the wrong thing and reporting a false failure.
    let version = null;
    try {
      const parsed = JSON.parse(text);
      const versions = (parsed.servers ?? []).map((x) => x?.server?.version).filter(Boolean);
      version = parsed.version ?? (versions.length ? versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) : null);
    } catch {}
    const local = JSON.parse(readFileSync(join(ROOT, "packages/mcp/package.json"), "utf8")).version;
    const aligned = version === local;
    rows.push({
      ...surface,
      found: aligned ? tools.length : 0,
      status,
      note: aligned ? `version ${version} aligned` : `version ${version ?? "?"} vs local ${local}`,
    });
    continue;
  }

  const found = tools.filter((t) => text.includes(t));
  const missing = tools.filter((t) => !text.includes(t));
  rows.push({
    ...surface,
    found: found.length,
    missing,
    status,
    note: found.length === tools.length ? "current" : `missing ${missing.length}: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`,
  });
}

const stale = rows.filter((r) => r.found !== null && r.found < tools.length);
const payload = { tools: tools.length, at: new Date().toISOString(), stale: stale.length, rows };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const r of rows) {
    const mark = r.found === null ? "??" : r.found === tools.length ? "ok" : "STALE";
    console.log(`${mark.padEnd(6)} ${r.name.padEnd(28)} ${r.found ?? "-"}/${tools.length}  ${r.note}`);
    if (r.found !== null && r.found < tools.length) console.log(`       → ${r.owner}`);
  }
  console.log(`\n${stale.length} stale of ${rows.length} readable surfaces (${tools.length} tools expected)`);
}
process.exit(stale.length === 0 ? 0 : 1);
