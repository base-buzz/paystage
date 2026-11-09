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
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
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
    record("cadence: releases and checks reported",
      typeof cadence.releases?.count === "number" && Array.isArray(cadence.checks?.recent_runs),
      `${cadence.releases?.count ?? "?"} releases, ${cadence.checks?.passing ?? "?"}/${cadence.checks?.total ?? "?"} checks`);
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

async function checkUnpaidChallenge() {
  const { res, text } = await get(`${API}/v1/evaluate_mcp_payment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment_required: { x402Version: 2, accepts: [] }, policy: {} }),
  });
  // 402 is the normal answer. 503 upstream_timeout is the documented fail-closed
  // state when facilitator discovery backs off (SLO.md) — a retryable degradation,
  // not a conformance failure. Anything else, or no answer at all, is a failure.
  const degraded = res.status === 503 && /upstream_timeout/.test(text);
  record("api: unpaid evaluate answers, challenge or documented degradation",
    res.status === 402 || degraded,
    `HTTP ${res.status}${degraded ? " (upstream_timeout — retryable)" : ""} ${degraded ? "" : text.slice(0, 40)}`);
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
