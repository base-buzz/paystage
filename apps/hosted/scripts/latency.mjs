#!/usr/bin/env node
/**
 * Measure this service's latency from the outside and print machine-readable
 * percentiles. Nothing here trusts a published number: it times real requests.
 *
 *   node scripts/latency.mjs [--base https://api.paystage.xyz] [--n 100]
 *
 * Measures the two paths that need no payment: `/health` and the unpaid
 * `/v1/evaluate_mcp_payment` challenge (402). That covers request handling,
 * routing and the payment check. It does **not** cover a full paid evaluation —
 * that needs a funded wallet and is measured separately, on purpose, so nobody
 * mistakes a fast 402 for a fast verdict.
 *
 * Uses Server-Timing when the response carries it, falls back to wall clock.
 */
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const base = arg("--base", "https://api.paystage.xyz").replace(/\/+$/, "");
const n = Number(arg("--n", "100"));

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function serverTimingMs(header) {
  if (!header) return null;
  const m = /app;dur=([0-9.]+)/.exec(header);
  return m ? Number(m[1]) : null;
}

async function measure(path, init) {
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    const started = performance.now();
    let res;
    try {
      res = await fetch(base + path, init);
    } catch {
      continue;
    }
    const wall = performance.now() - started;
    await res.arrayBuffer().catch(() => {});
    const server = serverTimingMs(res.headers.get("server-timing"));
    samples.push({ wall, server, status: res.status });
  }
  const walls = samples.map((s) => s.wall).sort((a, b) => a - b);
  const servers = samples
    .map((s) => s.server)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  const statuses = {};
  for (const s of samples) statuses[s.status] = (statuses[s.status] ?? 0) + 1;

  return {
    path,
    method: init?.method ?? "GET",
    samples: samples.length,
    statuses,
    wall_ms: {
      p50: pct(walls, 50),
      p95: pct(walls, 95),
      p99: pct(walls, 99),
      max: walls.at(-1) ?? null,
    },
    server_ms: servers.length
      ? { p50: pct(servers, 50), p95: pct(servers, 95), p99: pct(servers, 99) }
      : null,
  };
}

const results = await Promise.all([
  measure("/health"),
  measure("/v1/evaluate_mcp_payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment_required: { x402Version: 2, accepts: [] }, policy: {} }),
  }),
]);

console.log(
  JSON.stringify(
    {
      base,
      measured_at: new Date().toISOString(),
      note:
        "Unpaid paths only. A full paid evaluation needs a funded wallet and is not measured here.",
      results,
    },
    null,
    2,
  ),
);
