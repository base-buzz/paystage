#!/usr/bin/env node
/**
 * Incident drill (#59). An untested incident path is a story.
 *
 * Runs the failure modes we claim to fail closed on, against a real deployment, and writes a timeline with what
 * actually happened. The point is not that the service stays up — it is that a **broken caller** gets a refusal with a
 * reason, rather than a pass or an unhandled error.
 *
 *   node scripts/incident-drill.mjs                       # against the hosted sepolia endpoint
 *   node scripts/incident-drill.mjs --url http://localhost:8787
 *   node scripts/incident-drill.mjs --write               # writes docs/state/incident-drill-<date>.md
 *
 * Exit 0 every case behaved · 1 a case did not · 2 the drill could not run.
 */
import { writeFileSync } from "node:fs";

const urlFlag = process.argv.indexOf("--url");
const BASE = (urlFlag > 0 ? process.argv[urlFlag + 1] : "https://sepolia.api.paystage.xyz").replace(/\/+$/, "");

const GOOD_PAYMENT = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "1000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x000000000000000000000000000000000000dEaD",
      maxTimeoutSeconds: 300,
    },
  ],
};

const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/**
 * A policy that passes the schema, so the semantic cases below exercise *policy logic* rather than validation.
 * The first version of this drill used an incomplete policy: every case returned 400, which is a correct refusal but
 * proved nothing about the rules it claimed to test.
 */
const GOOD_POLICY = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x0000000000000000000000000000000000000001"],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC_SEPOLIA, network: "eip155:84532" }],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 600,
  unknown_payee: "deny",
};

/**
 * Each case is a thing a broken caller can do. The expectation is stated as data so a reader can check the claim
 * without reading the assertion code.
 */
const CASES = [
  {
    name: "policy that widens the global rules (per-agent override raises the ceiling)",
    why: "a policy that can loosen its own limits is a policy that is not one",
    body: {
      payment_required: GOOD_PAYMENT,
      policy: { ...GOOD_POLICY, agents: { reader: { max_amount: { value: "500", asset: "USDC", decimals: 6 } } } },
      agent_id: "reader",
    },
    expect: { neverPay: true },
  },
  {
    name: "unknown agent_id",
    why: "missing or unknown agent must not fall back to the loosest rules",
    body: { payment_required: GOOD_PAYMENT, policy: { ...GOOD_POLICY, agents: { reader: GOOD_POLICY } }, agent_id: "nobody" },
    expect: { neverPay: true },
  },
  {
    name: "payment with an unknown payee",
    why: "the payee is the thing most attacks change",
    body: { payment_required: GOOD_PAYMENT, policy: GOOD_POLICY },
    expect: { neverPay: true },
  },
  {
    name: "payment whose amount exceeds the ceiling",
    why: "a 402 response is attacker-controlled and can raise its own price",
    body: {
      payment_required: {
        ...GOOD_PAYMENT,
        accepts: [{ ...GOOD_PAYMENT.accepts[0], payTo: GOOD_POLICY.allowed_pay_to[0] }],
      },
      policy: { ...GOOD_POLICY, max_amount: { value: "0.0001", asset: "USDC", decimals: 6 } },
    },
    expect: { neverPay: true },
  },
  {
    name: "malformed body",
    why: "a parser that throws an unnamed error is a denial of service",
    raw: "{not json",
    expect: { neverPay: true },
  },
  {
    name: "empty policy",
    why: "an empty policy must refuse, not permit everything",
    body: { payment_required: GOOD_PAYMENT, policy: {} },
    expect: { neverPay: true },
  },
];

const startedAt = new Date().toISOString();
const rows = [];
let failures = 0;

for (const testCase of CASES) {
  const at = Date.now();
  let status = 0;
  let body;
  try {
    const res = await fetch(`${BASE}/v1/evaluate_mcp_payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: testCase.raw ?? JSON.stringify(testCase.body),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    body = await res.text();
  } catch (error) {
    rows.push({ name: testCase.name, verdict: "DRILL-ERROR", detail: String(error).slice(0, 120), ms: Date.now() - at });
    failures += 1;
    continue;
  }

  let decision = null;
  let reason = null;
  try {
    const parsed = JSON.parse(body);
    decision = parsed.decision ?? parsed.error ?? null;
    reason = parsed.reasons?.[0] ?? parsed.reason ?? parsed.detail ?? null;
  } catch {
    /* a non-JSON body is itself a finding */
  }

  // "Fail closed" is one property, not three: the caller must not receive `pay`. A 4xx with a named error and a
  // 200 with do_not_pay are both refusals; only `pay` — or an unhandled 5xx — is a breach.
  const paid = decision === "pay";
  const serverError = status >= 500;
  const ok = testCase.expect.neverPay ? !paid && !serverError : true;

  if (!ok) failures += 1;
  rows.push({
    name: testCase.name,
    why: testCase.why,
    status,
    decision,
    reason,
    verdict: ok ? "fail-closed" : "DID NOT FAIL CLOSED",
    ms: Date.now() - at,
  });
}

const finishedAt = new Date().toISOString();
const date = startedAt.slice(0, 10);

const report = [
  `# Incident drill — ${date}`,
  "",
  `Target: \`${BASE}\`. Every case is a broken caller; the service is not modified.`,
  "",
  `Started ${startedAt}, finished ${finishedAt}. **${rows.length - failures}/${rows.length} cases failed closed.**`,
  "",
  "| case | what a broken caller does | http | verdict | reason | ms |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${r.why ?? ""} | ${r.status} | ${r.verdict} | ${r.reason ?? "—"} | ${r.ms} |`),
  "",
  failures === 0
    ? "No incident path was found open. This drill proves the refusal path works against a live deployment; it does not prove the service is correct."
    : `**${failures} case(s) did not fail closed.** That is an incident, not a drill result.`,
]
  .join("\n")
  .replace(/^\| case.*\n\|.*\n/m, (header) => header);

console.log(report);
if (process.argv.includes("--write")) {
  writeFileSync(`docs/state/incident-drill-${date}.md`, report + "\n");
}
process.exit(failures === 0 ? 0 : 1);
