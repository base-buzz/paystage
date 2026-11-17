#!/usr/bin/env node
/**
 * One command, four verdicts, no network.
 *
 * The claim this file tests is the product's whole pitch: a policy and a payment challenge go in, a decision
 * with a reason comes out. Every case below is asserted, so this is a demo *and* a test — a stranger running it
 * sees the verdicts, and CI fails if one changes.
 *
 *   node examples/run.mjs
 *
 * Exit 0 when every case matches its expectation · 1 otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePayment } from "../packages/preflight/dist/evaluate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(HERE, p), "utf8"));
const policy = read("policies/strict.json");

const CASES = [
  ["over-cap", "challenges/over-cap.json", "do_not_pay", /exceeds max_amount/],
  ["unknown-payee", "challenges/unknown-payee.json", "do_not_pay", /not in allowed_pay_to/],
  // A cited payee from the curated list (0xCERT-2026-0230). This case used to point at the burn address,
  // which is not a drainer — it is a sink, and the next case is where that belongs.
  ["drainer", "challenges/drainer.json", "do_not_pay", /known drainer/],
  ["non-receivable", "challenges/non-receivable.json", "do_not_pay", /non-receivable/],
  ["allowed", "challenges/allowed.json", "pay", null],
];

let failed = 0;
console.log("policy: examples/policies/strict.json  (0.05 USDC cap, one allowed payee, deny unknowns)\n");
console.log("  case            decision       reason");

for (const [name, file, expected, pattern] of CASES) {
  const result = evaluatePayment(read(file), policy);
  const reason = result.reasons?.[0] ?? "—";
  const ok = result.decision === expected && (pattern === null || pattern.test(reason));
  if (!ok) failed += 1;
  console.log(`  ${name.padEnd(15)} ${result.decision.padEnd(14)} ${reason}`);
  if (!ok) console.log(`    ✗ expected ${expected}${pattern ? ` with ${pattern}` : ""}`);
}

console.log(
  failed === 0
    ? `\n${CASES.length}/${CASES.length} as expected. Nothing was signed, no key was used, no network call was made.`
    : `\n${failed} case(s) did not match.`,
);
process.exit(failed === 0 ? 0 : 1);
