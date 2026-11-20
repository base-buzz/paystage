#!/usr/bin/env node
/**
 * Turn one conformance JSON document into either the human summary or the one-line
 * record that goes in `docs/state/conformance.log`.
 *
 *   node scripts/conformance-evidence.mjs human /tmp/conformance.json
 *   node scripts/conformance-evidence.mjs line  /tmp/conformance.json <run-id> <run-url>
 *
 * Why a script: the cadence workflow runs the kit **once** with `--json` and needs
 * both a readable log and a machine line from that one network pass. Re-running the
 * kit for the human view costs a second round of live calls and — worse — can show a
 * different answer from the artefact it is supposed to explain.
 *
 * Exit codes: 0 = rendered a PASS document / valid line; 1 = a genuine FAIL document
 * (`human` mode); 2 = the input is not a conformance document at all, or arguments are
 * missing. The split matters: a failed check is evidence, unreadable output is not.
 *
 * Read-only, `node:` builtins only — it is safe in a job with no dependency install.
 */
import { readFileSync } from "node:fs";

const [mode, file, runId, runUrl] = process.argv.slice(2);

function usage(message) {
  console.error(`conformance-evidence: ${message}`);
  console.error("  node scripts/conformance-evidence.mjs human <json>");
  console.error("  node scripts/conformance-evidence.mjs line  <json> <run-id> <run-url>");
  process.exit(2);
}

if (mode !== "human" && mode !== "line") usage("unknown or missing mode");
if (!file) usage("missing JSON path");

let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  usage(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
}

const results = data?.results;
const failed = data?.failed;
if (!Array.isArray(results) || typeof failed !== "number" || typeof data?.checked_at !== "string") {
  usage(`${file} is not a conformance JSON document (need checked_at, results[], failed)`);
}

const total = results.length;
const passed = total - failed;
const status = failed === 0 ? "PASS" : "FAIL";

if (mode === "human") {
  const width = Math.max(0, ...results.map((r) => String(r.name).length));
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${String(r.name).padEnd(width)}  ${r.detail}`);
  }
  console.log(`\n${passed}/${total} passed  (${data.checked_at})`);
  process.exit(failed === 0 ? 0 : 1);
}

// mode === "line"
if (!runId) usage("missing run id");
if (!runUrl || !/^https?:\/\//.test(runUrl)) usage("missing or non-http(s) run URL");

// Fixed field order, two spaces between fields, so the log stays greppable:
// idempotency in the `record` job is `grep -q "run=<id>"`.
console.log(`${data.checked_at}  ${status}  ${passed}/${total}  run=${runId}  ${runUrl}`);
