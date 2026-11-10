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
const statuses = new Map();
let next = 0;

async function worker() {
  while (next < total) {
    next += 1;
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      await res.arrayBuffer().catch(() => {});
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
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

const unexpected = [...statuses.keys()].filter((s) => s !== 402 && s !== 503);
if (unexpected.length > 0) {
  console.error(`\nunexpected outcomes: ${unexpected.join(", ")}`);
  process.exit(1);
}
