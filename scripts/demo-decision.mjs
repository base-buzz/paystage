#!/usr/bin/env node
/**
 * Backlog #113 — the gate decides on an x402 402 before anything is signed.
 *
 * Reads real challenge fixtures, calls the same `evaluatePayment` the seller and
 * the guard use, and prints the verdict plus the evaluator's own rule id.
 * Offline only: no network, no key, no payment header, no funds.
 *
 *   node scripts/demo-decision.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePayment } from "../packages/preflight/dist/evaluate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function readFixture(path) {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`missing fixture: ${path}`);
      process.exit(1);
    }
    throw error;
  }
}

const strict = readFixture("examples/policies/strict.json");
const reviewPolicy = { ...strict, unknown_payee: "review" };
/**
 * The caller owns the payer's history (#414). This demo pays the allowlisted payee from a payer that has paid it
 * before, so the small payment crosses no step-up; the unknown payee has no such record, so it does.
 */
const CASES = [
  {
    name: "pay",
    fixture: "examples/challenges/allowed.json",
    policy: strict,
    expected: "pay",
    history: { payees: ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"], paymentCount: 3 },
  },
  {
    name: "review",
    fixture: "examples/challenges/unknown-payee.json",
    policy: reviewPolicy,
    expected: "review",
    history: { payees: [], paymentCount: 3 },
  },
  { name: "do_not_pay", fixture: "examples/challenges/over-cap.json", policy: strict, expected: "do_not_pay" },
];
const ruleOf = (result) =>
  result.steps.find((step) => step.outcome === "fail" || step.outcome === "review")?.rule ?? "none";

console.log("PayStage gate demo — a 402 challenge, decided before anything is signed");
console.log("Offline: fixture challenges and policy only. No network, no keys, no payment header.\n");
console.log("policy: examples/policies/strict.json (review case overrides unknown_payee=review)");
console.log("case        verdict      rule                          challenge");
let failed = 0;
for (const testCase of CASES) {
  const challenge = readFixture(testCase.fixture);
  const result = testCase.history
    ? evaluatePayment(challenge, testCase.policy, { paymentHistory: testCase.history })
    : evaluatePayment(challenge, testCase.policy);
  const rule = ruleOf(result);
  const ok = result.decision === testCase.expected;
  if (!ok) failed += 1;
  console.log(`${testCase.name.padEnd(11)} ${result.decision.padEnd(12)} ${rule.padEnd(29)} ${testCase.fixture}`);
  const accept = challenge.accepts[0];
  console.log(`            ${accept.amount} atomic USDC on ${accept.network} to ${accept.payTo}`);
  console.log(`            reason: ${result.reasons[0] ?? "none — no rule blocked the payment"}`);
  if (!ok) console.log(`            MISMATCH: expected ${testCase.expected}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} verdicts as expected. Nothing was signed.`);
process.exit(failed === 0 ? 0 : 1);
