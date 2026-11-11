#!/usr/bin/env node
/**
 * Load test for the hosted gate — the numbers a buyer asks for before paying.
 *
 * Deliberately measures the *unpaid challenge path*. That is what a cold agent hits
 * first, it is what a griefer would flood, and it is the only path we can exercise
 * without spending money.
 *
 *   node scripts/load-test.mjs                # 300 calls, 20 concurrent
 *   node scripts/load-test.mjs --total 50 --conc 5 --url https://sepolia...
 *
 * Prints a p50/p95/p99 table and a status histogram. Exit 1 if anything other than a
 * 402 or the documented 503 comes back.
 */

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const url = opt("url", "https://api.paystage.xyz/v1/evaluate_mcp_payment");
const total = Number(opt("total", "300"));
const conc = Number(opt("conc", "20"));
const body = JSON.stringify({
  payment_required: { x402Version: 2, accepts: [] },
  policy: {},
});

const latencies = [];
const appTimes = [];
const statuses = new Map();
let next = 0;

async function worker() {
  while (next < total) {
    next += 1;
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-paystage-source": "test" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      await res.arrayBuffer().catch(() => {});
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      // `server-timing: app;dur=N` is what the Worker itself spent. Everything else in
      // the round trip is connection setup and edge queueing, which are not ours — and
      // confusing the two is how a connection-pool limit gets mistaken for a slow API.
      const timing = res.headers.get("server-timing") ?? "";
      const match = timing.match(/dur=([\d.]+)/);
      if (match) appTimes.push(Number(match[1]));
    } catch {
      statuses.set("network-error", (statuses.get("network-error") ?? 0) + 1);
    }
    latencies.push(Date.now() - started);
  }
}

const startedAt = Date.now();
await Promise.all(Array.from({ length: conc }, worker));
const wall = Date.now() - startedAt;

latencies.sort((a, b) => a - b);
const pct = (q) => latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * q))];

console.log(`target:      ${url}`);
console.log(`load:        ${total} calls, ${conc} concurrent`);
console.log(`wall:        ${wall} ms  (~${Math.round((total / wall) * 1000)} req/s)`);
console.log(`statuses:    ${[...statuses].map(([s, n]) => `${s}×${n}`).join("  ")}`);
console.log(`latency:     p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms · p99 ${pct(0.99)} ms · max ${latencies.at(-1)} ms`);
if (appTimes.length > 0) {
  const appPct = (q) => {
    const a = [...appTimes].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor((a.length - 1) * q))];
  };
  console.log(`worker time: p50 ${appPct(0.5)} ms · p95 ${appPct(0.95)} ms · max ${Math.max(...appTimes)} ms  (server-timing)`);
}

const unexpected = [...statuses.keys()].filter((s) => s !== 402 && s !== 503);
if (unexpected.length > 0) {
  console.error(`\nunexpected outcomes: ${unexpected.join(", ")}`);
  process.exit(1);
}
