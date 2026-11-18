#!/usr/bin/env node
/**
 * Which installed version is actually calling us (#52).
 *
 * npm reports downloads; a download is not a call. This reads the telemetry table and groups recent calls by the SDK
 * build that made them, which is the only honest way to answer "is anyone on the version we just published".
 *
 *   node scripts/attribution-report.mjs --days 7
 *   node scripts/attribution-report.mjs --json
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (the same two the worker uses). Read-only.
 * Exit 0 report produced · 2 no credentials or the query failed. An empty result is a real answer, not an error.
 */
const daysFlag = process.argv.indexOf("--days");
const days = daysFlag > 0 ? Number(process.argv[daysFlag + 1]) : 7;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("attribution: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (read-only use)");
  process.exit(2);
}

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const query =
  `events?select=client_package,client_version,source,tool,ts&ts=gte.${since}` +
  `&client_version=not.is.null&limit=20000`;

let rows;
try {
  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  rows = await res.json();
} catch (error) {
  console.error(`attribution: query failed (${error instanceof Error ? error.message : String(error)})`);
  process.exit(2);
}

const byVersion = new Map();
for (const row of rows) {
  const key = `${row.client_package ?? "unknown"}@${row.client_version ?? "unknown"}`;
  const entry = byVersion.get(key) ?? { calls: 0, tools: new Set(), sources: new Set(), lastSeen: row.ts };
  entry.calls += 1;
  entry.tools.add(row.tool);
  entry.sources.add(row.source);
  if (row.ts > entry.lastSeen) entry.lastSeen = row.ts;
  byVersion.set(key, entry);
}

const report = [...byVersion.entries()]
  .map(([version, v]) => ({
    version,
    calls: v.calls,
    tools: [...v.tools].sort(),
    sources: [...v.sources].sort(),
    lastSeen: v.lastSeen,
  }))
  .sort((a, b) => b.calls - a.calls);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ windowDays: days, total: rows.length, byVersion: report }, null, 2));
  process.exit(0);
}

console.log(`attribution: ${rows.length} attributed call(s) in the last ${days} day(s)`);
if (report.length === 0) {
  console.log("  none — no caller sent a client id. Attribution starts on the first request that does.");
} else {
  console.log("  version                        calls   sources");
  for (const r of report) {
    console.log(`  ${r.version.padEnd(30)} ${String(r.calls).padStart(5)}   ${r.sources.join(", ")}`);
  }
}
console.log("\nA call is not a user, and a download is not a call: this counts builds, not people.");
