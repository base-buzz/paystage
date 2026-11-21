#!/usr/bin/env node
/**
 * `paystage-verify-bundle proof.json` — check a proof without trusting its issuer.
 *
 * Exit 0 match · 1 mismatch or not recomputable · 2 the proof could not be read or parsed.
 * The JSON report goes to stdout so a pipeline can keep the evidence, not just the exit code.
 */

import { readFileSync } from "node:fs";
import { describeVerification, verifyBundle, type EvidenceProof } from "./verify-bundle.js";

const [file] = process.argv.slice(2);

let text: string;
try {
  text = !file || file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
} catch (error) {
  console.error(`verify-bundle: cannot read ${file ?? "stdin"}: ${(error as Error).message}`);
  process.exit(2);
}

let parsed: unknown;
try {
  parsed = JSON.parse(text);
} catch {
  console.error("verify-bundle: proof is not valid JSON");
  process.exit(2);
}

const result = await verifyBundle(parsed as EvidenceProof);
console.log(JSON.stringify(result, null, 2));
console.error(describeVerification(result));

if (result.status === "invalid") process.exit(2);
process.exit(result.ok ? 0 : 1);
