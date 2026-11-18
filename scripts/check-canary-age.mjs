#!/usr/bin/env node
/**
 * Dead-man switch for the hourly canary (item 75).
 *
 * The canary writes one line per run to `/work/ops/docs/state/canary.log`. If it stops, nothing fails: the site stays
 * up, the badge keeps showing the last known state, and the silence looks like a quiet period. This fails loudly when
 * the newest line is older than the threshold.
 *
 *   node scripts/check-canary-age.mjs              # exit 0 fresh · 1 stale · 2 cannot read
 *   node scripts/check-canary-age.mjs --hours 36
 */
import { readFileSync, existsSync } from "node:fs";

const LOG = process.env.CANARY_LOG ?? "/work/ops/docs/state/canary.log";
const hoursArg = process.argv.indexOf("--hours");
const maxHours = hoursArg > 0 ? Number(process.argv[hoursArg + 1] ?? 36) : 36;

if (!existsSync(LOG)) {
  console.error(`canary-age: no log at ${LOG} — a canary that never ran is not a quiet canary`);
  process.exit(2);
}

const lines = readFileSync(LOG, "utf8").split("\n").filter((l) => l.trim());
let newest = null;
for (let i = lines.length - 1; i >= 0 && newest === null; i -= 1) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(lines[i] ?? "");
  if (m) newest = new Date(m[1]);
}
if (newest === null || Number.isNaN(newest.getTime())) {
  console.error(`canary-age: ${lines.length} line(s) but no parseable timestamp`);
  process.exit(2);
}

const age = (Date.now() - newest.getTime()) / 3_600_000;
if (age > maxHours) {
  console.error(`canary-age: SILENT for ${age.toFixed(1)}h (limit ${maxHours}h). Newest line ${newest.toISOString().slice(0, 16)}Z.`);
  console.error("  The canary is the check that notices a broken payment path; its own silence needs one too.");
  process.exit(1);
}
console.log(`canary-age: fresh — newest run ${age.toFixed(1)}h ago (limit ${maxHours}h)`);
