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

/**
 * A real payment, judged by the real evaluator.
 *
 * This used to send `{accepts: [], policy: {}}` and assert 402. That only ever tested the
 * payment middleware, never the product — and once the free tier began serving unpaid calls,
 * an invalid body started returning 400 and the probe called it an outage.
 *
 * Now it sends a valid challenge and accepts either outcome, because both are correct:
 *   200 with a verdict   -> the free tier served it (no payment, no signup)
 *   402                   -> the daily allowance is spent and the gate asks for payment
 * A 400 here is a genuine failure: the evaluator rejected a policy that parses everywhere else.
 * 503 remains an outage for the same reason as before — an agent that cannot get a verdict
 * cannot pay.
 */
const CHALLENGE = {
  name: "mainnet evaluate (real policy)",
  url: "https://api.paystage.xyz/v1/evaluate_mcp_payment",
  expect: [200, 402],
};

const REAL_POLICY = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      network: "eip155:8453",
    },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

const REAL_CHALLENGE = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "2000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
      maxTimeoutSeconds: 300,
    },
  ],
};

const TIMEOUT_MS = 12_000;

async function probe(target, init) {
  const started = Date.now();
  try {
    const res = await fetch(target.url, {
      ...init,
      // Label our own probe so it is never counted as a real caller in /api/metrics.
      headers: { "x-paystage-source": "test", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
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
    headers: { "content-type": "application/json", "x-paystage-source": "test" },
    body: JSON.stringify({ payment_required: REAL_CHALLENGE, policy: REAL_POLICY }),
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
