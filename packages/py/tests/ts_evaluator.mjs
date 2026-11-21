#!/usr/bin/env node
/**
 * Run the TypeScript evaluator over the Python contract cases.
 *
 * The live test reads the result of this process and compares it with what the
 * hosted MCP endpoint returned to the Python client. The point is that the
 * expected answer comes from the evaluator itself, not from a Python copy of
 * its rules.
 *
 * Reads a JSON array of {name, payment_required, policy, agent_id?} on stdin and
 * writes a JSON array of {name, decision, packet, reasons, summary}.
 *
 *   node packages/py/tests/ts_evaluator.mjs < cases.json
 */
import { readFileSync } from "node:fs";
import { evaluatePayment } from "../../preflight/dist/evaluate.js";

const input = readFileSync(0, "utf8");
const cases = JSON.parse(input);
if (!Array.isArray(cases)) {
  console.error("ts_evaluator: stdin must be a JSON array of cases");
  process.exit(2);
}

const output = cases.map((testCase) => {
  const options =
    typeof testCase.agent_id === "string" ? { agentId: testCase.agent_id } : {};
  const result = evaluatePayment(
    testCase.payment_required,
    testCase.policy,
    options,
  );
  return {
    name: testCase.name,
    decision: result.decision,
    packet: result.packet ?? null,
    reasons: result.reasons ?? [],
    summary: result.summary ?? "",
  };
});

process.stdout.write(JSON.stringify(output));
