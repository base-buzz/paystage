#!/usr/bin/env node
/**
 * Uptime probe — what a caller experiences, measured from outside the Worker.
 *
 * The conformance kit answers "does everything we published still hold?" once a day.
 * This answers "can an agent reach the gate right now?" every ten minutes, which is
 * a different question and the one that matters during an incident.
 *
 * It runs on GitHub's network, so it is external to the Cloudflare Worker that
 * serves the API. It is still *our* infrastructure — a genuinely independent monitor
 * needs an account we do not control — but a Worker outage, a bad deploy or a
 * DNS problem shows up here, none of which our own CI would catch.
 *
 * Exit code 1 if anything that should answer does not. Prints one JSON line so the
 * workflow can build an issue body from it.
 */

const TARGETS = [
  { name: "mainnet /health", url: "https://api.paystage.xyz/health", expect: [200] },
  { name: "mainnet receipt key", url: "https://api.paystage.xyz/v1/public/receipt-key.json", expect: [200] },
  { name: "sepolia /health", url: "https://sepolia.api.paystage.xyz/health", expect: [200] },
  { name: "site", url: "https://paystage.xyz/", expect: [200] },
  { name: "cadence", url: "https://paystage.xyz/v1/public/cadence.json", expect: [200] },
];

const CHALLENGE = {
  name: "mainnet challenge",
  url: "https://api.paystage.xyz/v1/evaluate_mcp_payment",
  expect: [402, 503], // 503 upstream_timeout is the documented fail-closed state
};

const TIMEOUT_MS = 12_000;

async function probe(target, init) {
  const started = Date.now();
  try {
    const res = await fetch(target.url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.arrayBuffer().catch(() => {});
    const ok = target.expect.includes(res.status);
    return {
      name: target.name,
      ok,
      status: res.status,
      ms: Date.now() - started,
      server_timing: res.headers.get("server-timing") ?? null,
    };
  } catch (error) {
    return {
      name: target.name,
      ok: false,
      status: null,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const results = [];
for (const target of TARGETS) results.push(await probe(target));
results.push(
  await probe(CHALLENGE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment_required: { x402Version: 2, accepts: [] }, policy: {} }),
  }),
);

const failed = results.filter((r) => !r.ok);
const payload = {
  checked_at: new Date().toISOString(),
  ok: failed.length === 0,
  failed: failed.map((f) => `${f.name}: ${f.status ?? f.error}`),
  results,
};

console.log(JSON.stringify(payload));
process.exit(failed.length === 0 ? 0 : 1);
