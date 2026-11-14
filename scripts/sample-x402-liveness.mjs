#!/usr/bin/env node
/**
 * Sample x402 servers from the official MCP registry and measure whether they answer.
 *
 * The output is meant to be published, so the method is part of the result: a share without a sample
 * size and a date is not a finding. Two consequences are baked in:
 *
 *   DETERMINISTIC  the sample is the N servers with the smallest sha256(name), so next month's run
 *                  measures the same population and a change in the number means a change in the
 *                  ecosystem rather than a change in the dice.
 *   NO RETRIES     one initialize, one tools/list, ten seconds. A server that answers on the third
 *                  attempt is not a server an agent can use, and pretending otherwise would flatter
 *                  the first number we ever publish.
 *
 *   node scripts/sample-x402-liveness.mjs                 # N=40, writes /work/ops/docs/specs/liveness.md
 *   node scripts/sample-x402-liveness.mjs --n 20 --json
 *
 * Public endpoints only. No auth, no payment, nothing that costs money.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.indexOf(name) >= 0 ? Number(args[args.indexOf(name) + 1]) : fallback);
const N = flag('--n', 40);
const TIMEOUT_MS = flag('--timeout', 10_000);
const OUT = '/work/ops/docs/specs/liveness.md';

const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

/** Stable selection: the N entries with the lowest hash of their name. Deterministic across runs. */
const sampleKey = (name) => createHash('sha256').update(name).digest('hex');

async function fetchRegistry() {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 12; page += 1) {
    const url = `https://registry.modelcontextprotocol.io/v0/servers?limit=100&search=x402${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) break;
    const body = await res.json();
    for (const s of body.servers ?? []) out.push(s.server ?? s);
    cursor = body.metadata?.nextCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

/** Streamable HTTP may answer with JSON or an SSE stream; both are valid. */
function parseBody(text) {
  if (text.startsWith('event:') || text.includes('\ndata: ')) {
    return text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
  }
  return text;
}

async function probe(url) {
  const started = Date.now();
  let sessionId = null;
  try {
    const initRes = await fetch(url, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'paystage-liveness', version: '1' } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    sessionId = initRes.headers.get('mcp-session-id');
    if (!initRes.ok) return { answered: false, toolCount: null, latencyMs: Date.now() - started, reason: `HTTP ${initRes.status}` };
    const init = JSON.parse(parseBody(await initRes.text()));
    if (init.error) return { answered: false, toolCount: null, latencyMs: Date.now() - started, reason: `initialize error ${init.error.code}` };

    const listRes = await fetch(url, {
      method: 'POST',
      headers: { ...H, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!listRes.ok) return { answered: true, toolCount: null, latencyMs: Date.now() - started, reason: `tools/list HTTP ${listRes.status}` };
    const list = JSON.parse(parseBody(await listRes.text()));
    if (list.error) return { answered: true, toolCount: null, latencyMs: Date.now() - started, reason: `tools/list error ${list.error.code}` };
    return { answered: true, toolCount: (list.result?.tools ?? []).length, latencyMs: Date.now() - started, reason: null };
  } catch (err) {
    return { answered: false, toolCount: null, latencyMs: Date.now() - started, reason: String(err.name === 'TimeoutError' ? 'timeout' : err.message).slice(0, 60) };
  }
}

const quantile = (sorted, q) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);

const entries = await fetchRegistry();
const allWithRemote = entries
  .map((e) => ({ name: e.name, version: e.version, url: (e.remotes ?? []).find((r) => r?.url)?.url ?? null }))
  .filter((e) => e.url);

// Dedupe by NAME before sampling. The registry returns one row per version, so a publisher with 20
// releases occupies 20 slots in a name-hashed selection — a cluster of identical endpoints that looks
// like 20 independent observations. Without this, N=40 and N=100 disagreed by 27 points (12.5% vs 40%)
// because the extra 60 rows were mostly the same few publishers, not new servers.
const seen = new Set();
const withRemote = [];
for (const e of allWithRemote) {
  if (seen.has(e.name)) continue;
  seen.add(e.name);
  withRemote.push(e);
}
const duplicateRows = allWithRemote.length - withRemote.length;

const sample = withRemote
  .sort((a, b) => sampleKey(a.name).localeCompare(sampleKey(b.name)) || a.name.localeCompare(b.name))
  .slice(0, N);

const results = [];
for (const e of sample) {
  const r = await probe(e.url);
  results.push({ ...e, ...r });
}

const silent = results.filter((r) => !r.answered).length;
const zeroTools = results.filter((r) => r.answered && r.toolCount === 0).length;
const usable = results.filter((r) => r.answered && (r.toolCount ?? 0) > 0);
const counts = usable.map((r) => r.toolCount).sort((a, b) => a - b);
const latencies = results.filter((r) => r.answered).map((r) => r.latencyMs).sort((a, b) => a - b);
const pct = (n) => `${((n / results.length) * 100).toFixed(1)}%`;
const date = new Date().toISOString().slice(0, 10);

const md = `# x402 server liveness — ${date}

Published measurement, not a slogan. If this month contradicts our positioning, that is the result.

## Result

| Measure | Value |
|---|---|
| Universe (registry rows with a remote URL) | ${allWithRemote.length} |
| Duplicate rows removed (same name, several versions) | ${duplicateRows} |
| Distinct servers sampled | ${withRemote.length} |
| Sample size | **${results.length}** |
| Did not answer | **${silent}** (${pct(silent)}) |
| Answered but exposed zero tools | **${zeroTools}** (${pct(zeroTools)}) |
| Usable (answered with ≥1 tool) | **${usable.length}** (${pct(usable.length)}) |
| Tools per usable server — median | **${quantile(counts, 0.5) ?? "n/a"}** |
| Tools per usable server — quartiles | ${quantile(counts, 0.25) ?? "n/a"} / ${quantile(counts, 0.75) ?? "n/a"} |
| Latency (answered) — median | ${quantile(latencies, 0.5) ?? "n/a"} ms |

## Method (enough to reproduce)

1. Read \`/v0/servers?search=x402\` from the official MCP registry, following cursors, and keep entries
   that declare a \`remotes[].url\`. No filter on version or publisher.
2. Order by \`sha256(name)\` ascending and take the first ${N}. The selection is deterministic, so the
   same month sampled twice gives the same servers, and next month measures the same population.
3. For each URL: one JSON-RPC \`initialize\`, then one \`tools/list\`, either attempt allowed
   ${TIMEOUT_MS / 1000}s. No retries — a server that answers on a third attempt is not one an agent can
   rely on.
4. "Did not answer" means no successful HTTP response, a timeout, or a JSON-RPC error on
   \`initialize\`. "Zero tools" means \`tools/list\` succeeded with an empty array.
5. Public endpoints only; no auth, no payment, nothing that costs money.

Reproduce: \`node scripts/sample-x402-liveness.mjs --n ${N}\` (writes this file).

## Per-server

| server | answered | tools | ms | note |
|---|---|---|---|---|
${results.map((r) => `| \`${r.name}\` | ${r.answered ? "yes" : "**no**"} | ${r.toolCount ?? "—"} | ${r.latencyMs} | ${r.reason ?? ""} |`).join('\n')}
`;

writeFileSync(OUT, md);

const line = `x402 liveness ${date}: ${results.length} sampled — ${pct(silent)} silent, ${pct(zeroTools)} zero-tool, median ${quantile(counts, 0.5) ?? "n/a"} tools, usable ${pct(usable.length)}`;
if (args.includes('--json')) {
  console.log(JSON.stringify({ date, universe: withRemote.length, n: results.length, silent, zeroTools, usable: usable.length, medianTools: quantile(counts, 0.5), results }, null, 2));
} else {
  console.log(line);
  console.log(`wrote ${OUT}`);
}
