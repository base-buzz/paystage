#!/usr/bin/env node
/**
 * PayStage conformance check.
 *
 * One command that verifies the published surfaces behave as documented. Every
 * claim the site makes about itself should be reducible to a line in here.
 *
 *   node apps/hosted/scripts/conformance.mjs
 *   node apps/hosted/scripts/conformance.mjs --json
 *
 * Read-only. Sends no payment, needs no key, writes nothing. Safe to run in CI
 * after a deploy and safe for a stranger to run against production.
 *
 * Exit code 1 if any check fails, so it can gate a pipeline.
 */

const SITE = process.env.PAYSTAGE_SITE ?? "https://paystage.xyz";
const API = process.env.PAYSTAGE_API ?? "https://api.paystage.xyz";
const API_SEPOLIA = process.env.PAYSTAGE_API_SEPOLIA ?? "https://sepolia.api.paystage.xyz";
const REPO_RAW = "https://raw.githubusercontent.com/base-buzz/paystage/main";

const TOOLS = [
  "evaluate_mcp_payment",
  "list_outstanding_auths",
  "evaluate_outstanding_auths",
  "evaluate_hip3_trade",
  "evaluate_velocity",
];

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

/** Every request is bounded: a conformance run must never hang on a slow endpoint. */
const TIMEOUT_MS = Number(process.env.PAYSTAGE_CONFORMANCE_TIMEOUT_MS ?? 10_000);

async function get(url, init = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    ...init,
    // Our own checks must never be counted as real callers. `/api/metrics` treats an
    // unlabelled request as real, so omitting this inflated realCount24h.
    headers: { "x-paystage-source": "test", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text().catch(() => "");
  return { res, text, ms: Date.now() - started };
}

async function checkSite() {
  const { res, text } = await get(`${SITE}/`);
  record("site: / serves the pitch", res.ok && /Safety tools for AI agent payments/i.test(text),
    `HTTP ${res.status}`);

  const manifestRes = await get(`${SITE}/.well-known/paystage.json`);
  let manifest;
  try {
    manifest = JSON.parse(manifestRes.text);
  } catch {
    record("site: manifest parses", false, `HTTP ${manifestRes.res.status}`);
    return;
  }
  record("site: manifest parses", true, `HTTP ${manifestRes.res.status}`);
  record("manifest: holds no keys", manifest.holds_keys === false, `holds_keys=${manifest.holds_keys}`);
  record("manifest: five tools", Array.isArray(manifest.tools) && manifest.tools.length === 5,
    `${manifest.tools?.length ?? 0} tools`);
  record("manifest: receipts documented", Boolean(manifest.receipts), manifest.receipts ? "present" : "missing");
  record("manifest: reliability documented", Boolean(manifest.reliability),
    manifest.reliability ? "present" : "missing");

  const llms = await get(`${SITE}/llms.txt`);
  record("site: /llms.txt lists every tool",
    llms.res.ok && TOOLS.every((t) => llms.text.includes(t)),
    `HTTP ${llms.res.status}`);

  const llmsFull = await get(`${SITE}/llms-full.txt`);
  // The two files must say different things, not merely exist. A near-duplicate
  // is the failure mode this catches (they were byte-identical until 8 Nov).
  const divergence = llms.text.length === 0 ? 0 : llmsFull.text.length / llms.text.length;
  record("site: /llms-full.txt is distinct from llms.txt",
    llmsFull.res.ok && divergence > 1.2,
    `${llmsFull.text.length} vs ${llms.text.length} bytes (${divergence.toFixed(1)}x)`);

  // The cadence endpoint is how an agent checks the project is alive. If it stops
  // answering, that claim silently rots.
  const cadenceRes = await get(`${SITE}/v1/public/cadence.json`);
  let cadence;
  try {
    cadence = JSON.parse(cadenceRes.text);
  } catch {
    cadence = null;
  }
  record("site: /v1/public/cadence.json parses",
    cadenceRes.res.ok && cadence !== null,
    `HTTP ${cadenceRes.res.status}`);
  if (cadence) {
    // "GitHub would not answer" is not "the cadence is wrong". The endpoint already says
    // which by setting `available: false`, so treat that as a documented degradation
    // rather than a failure — otherwise the check goes red every time the Worker's shared
    // egress IP is rate limited, and a permanently red check teaches people to ignore it.
    const unavailable = cadence.releases?.available === false || cadence.checks?.available === false;
    const shapeOk = typeof cadence.releases?.count === "number" && Array.isArray(cadence.checks?.recent_runs);
    record("cadence: releases and checks reported",
      shapeOk || unavailable,
      unavailable
        ? "data unavailable (GitHub rate limited the read) — not a cadence failure"
        : `${cadence.releases?.count ?? "?"} releases, ${cadence.checks?.passing ?? "?"}/${cadence.checks?.total ?? "?"} checks`);
  }

  // The machine surfaces are what an agent reads before it trusts anything. If they
  // describe an older product than the one shipping, the tools nobody can find are
  // also the tools nobody knows about.
  const llmsSurface = await get(`${SITE}/llms.txt`);
  record("site: /llms.txt documents agent_id", /agent_id/.test(llmsSurface.text), llmsSurface.text.includes("agent_id") ? "present" : "missing");
  record("site: /llms.txt documents paystage-verify", /paystage-verify/.test(llmsSurface.text), llmsSurface.text.includes("paystage-verify") ? "present" : "missing");

  const manifestCheck = await get(`${SITE}/.well-known/paystage.json`);
  let manifestNow;
  try { manifestNow = JSON.parse(manifestCheck.text); } catch { manifestNow = null; }
  if (manifestNow) {
    const verifyList = Array.isArray(manifestNow.verify) ? manifestNow.verify.join(" ") : "";
    record("manifest: verify list mentions the receipt checker", /paystage-verify/.test(verifyList), verifyList.includes("paystage-verify") ? "present" : "missing");
  }

  const security = await get(`${REPO_RAW}/SECURITY.md`);
  record("docs: SECURITY.md is reachable", security.res.ok, `HTTP ${security.res.status}`);

  // Version drift between the manifest and the registry is the failure mode that
  // makes an agent install something else than what the docs describe.
  const npm = await get("https://registry.npmjs.org/@paystage%2Fmcp/latest").catch(() => null);
  if (npm?.res?.ok) {
    let published;
    try {
      published = JSON.parse(npm.text).version;
    } catch {
      published = undefined;
    }
    record("registry: @paystage/mcp reachable", true, published ? `v${published}` : "unknown");
    if (published && manifest.package_versions?.["@paystage/mcp"]) {
      // Direction matters. Manifest BEHIND npm means the site advertises something
      // older than what people install — that is drift, and it fails.
      // Manifest AHEAD of npm is the normal gap between a merge and a tag, so it
      // warns without failing; otherwise every day between release PR and publish
      // is a red check, and a check that is always red gets ignored.
      const local = manifest.package_versions["@paystage/mcp"];
      const cmp = compareVersions(local, published);
      record("registry: site is not advertising an older version than npm", cmp >= 0,
        cmp === 0 ? `aligned at ${published}` : cmp > 0 ? `manifest ${local} ahead of npm ${published} (publish pending)` : `manifest ${local} is BEHIND npm ${published}`);
    }
  } else {
    record("registry: @paystage/mcp reachable", false, "registry fetch failed");
  }
}

async function checkApi(base, label) {
  const health = await get(`${base}/health`);
  record(`${label}: /health`, health.res.ok, `HTTP ${health.res.status}`);

  const timing = health.res.headers.get("server-timing");
  record(`${label}: Server-Timing present`, Boolean(timing), timing ?? "absent");

  const key = await get(`${base}/v1/public/receipt-key.json`);
  let keyBody = {};
  try {
    keyBody = JSON.parse(key.text);
  } catch {}
  record(`${label}: receipt key endpoint answers`,
    key.res.ok && typeof keyBody.configured === "boolean",
    `configured=${keyBody.configured}`);
}

/** Numeric comparison of `x.y.z` version strings: -1 older, 0 same, 1 newer. */
function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

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

async function checkUnpaidChallenge() {
  // Written before the free tier existed, this sent `{accepts: [], policy: {}}` and demanded 402.
  // The free tier now answers unpaid calls, and that body is invalid input, so the kit began
  // reporting 400 as a conformance failure — while the actual product was working. A check that
  // tests the payment middleware instead of the evaluator will always drift out of date.
  //
  // It now sends a real challenge and policy, and accepts every correct outcome:
  //   200 with a verdict  -> the free tier served it (no payment, no signup)
  //   402                 -> daily allowance spent, payment required
  //   503 upstream_timeout-> documented fail-closed degradation (SLO.md), retryable
  const { res, text } = await get(`${API}/v1/evaluate_mcp_payment`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystage-source": "test" },
    body: JSON.stringify({ payment_required: REAL_CHALLENGE, policy: REAL_POLICY }),
  });

  let decision = null;
  if (res.status === 200) {
    try {
      decision = JSON.parse(text)?.decision ?? null;
    } catch {}
  }
  const degraded = res.status === 503 && /upstream_timeout/.test(text);
  const ok = (res.status === 200 && ["pay", "review", "do_not_pay"].includes(decision)) ||
    res.status === 402 || degraded;

  record(
    "api: unpaid evaluate answers with a verdict, a challenge, or documented degradation",
    ok,
    res.status === 200
      ? `HTTP 200 decision=${decision ?? "MALFORMED"}`
      : `HTTP ${res.status}${degraded ? " (upstream_timeout — retryable)" : ` ${text.slice(0, 40)}`}`,
  );
}

async function checkDocsNotLying() {
  // The site claims fail-closed. Verify the cheapest instance of that claim:
  // a malformed body must not come back as a success.
  const { res } = await get(`${API}/v1/evaluate_mcp_payment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  record("api: malformed input fails closed", res.status >= 400, `HTTP ${res.status}`);
}

// Sequential and named, so a timeout says *which* surface failed rather than
// just "a check threw".
const groups = [
  ["site + docs", checkSite],
  ["api", () => checkApi(API, "api")],
  ["sepolia", () => checkApi(API_SEPOLIA, "sepolia")],
  ["unpaid challenge", checkUnpaidChallenge],
  ["fail-closed", checkDocsNotLying],
];

for (const [name, run] of groups) {
  try {
    await run();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    record(`${name}: group completed`, false, reason);
  }
}

const failed = results.filter((r) => !r.ok);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ checked_at: new Date().toISOString(), site: SITE, api: API, results, failed: failed.length }, null, 2));
} else {
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed  (${new Date().toISOString()})`);
}

process.exit(failed.length === 0 ? 0 : 1);
