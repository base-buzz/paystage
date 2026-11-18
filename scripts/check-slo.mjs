#!/usr/bin/env node
/**
 * Compute the error budget, do not just document it (#58).
 *
 * `docs/SLO.md` states a target and nothing measured it, so the document stayed true by being unread. This reads the
 * uptime probe's history and fails when the budget for the window is spent or projected to be spent.
 *
 *   node scripts/check-slo.mjs                 # vs docs/state/uptime.json
 *   node scripts/check-slo.mjs --json
 *
 * Exit 0 budget intact · 1 budget spent or will be · 2 no probe data (which is itself a failure: an unmeasured SLO is
 * the thing this exists to prevent).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY = process.env.UPTIME_HISTORY ?? join(ROOT, "docs/state/uptime.json");

/** The target, stated once. 99.9% over 30 days allows ~43 minutes of downtime. */
const TARGET = Number(process.env.SLO_TARGET ?? 0.999);
const WINDOW_DAYS = 30;

if (!existsSync(HISTORY)) {
  console.error(`slo: no measurement history at ${HISTORY} — an SLO nobody measures is a sentence, not a target`);
  process.exit(2);
}

let probes;
try {
  probes = JSON.parse(readFileSync(HISTORY, "utf8"));
} catch (error) {
  console.error(`slo: ${HISTORY} is not valid JSON (${error.message})`);
  process.exit(2);
}
if (!Array.isArray(probes) || probes.length === 0) {
  console.error("slo: the history is empty — nothing to compute");
  process.exit(2);
}

// Budget in MINUTES of downtime, not in probe count: an SLO is a fraction of time, and counting probes makes the
// allowance depend on how often we happen to probe. A failing probe is charged the interval to the probe before it,
// capped at the polling cadence, so one hourly failure costs about an hour — which is what it actually costs.
const CADENCE_MINUTES = Number(process.env.SLO_PROBE_INTERVAL_MINUTES ?? 60);
const allowedDowntimeMinutes = WINDOW_DAYS * 24 * 60 * (1 - TARGET);

const sorted = [...probes].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
const windowed = sorted.filter((p) => new Date(p.at).getTime() >= cutoff);
if (windowed.length === 0) {
  console.error(`slo: no probes in the last ${WINDOW_DAYS} days — the window cannot be computed`);
  process.exit(2);
}

let downtimeMinutes = 0;
let failures = 0;
for (let i = 0; i < windowed.length; i += 1) {
  if (windowed[i].ok !== false) continue;
  failures += 1;
  const previous = windowed[i - 1] ?? windowed[i];
  const gap = (new Date(windowed[i].at).getTime() - new Date(previous.at).getTime()) / 60_000;
  downtimeMinutes += Math.min(CADENCE_MINUTES, Math.max(1, gap));
}

const windowStart = new Date(windowed[0].at).getTime();
const elapsedDays = Math.max(1 / 24, (Date.now() - windowStart) / 86_400_000);
const remaining = allowedDowntimeMinutes - downtimeMinutes;
const projectedDowntime = (downtimeMinutes / elapsedDays) * WINDOW_DAYS;

const report = {
  target: TARGET,
  windowDays: WINDOW_DAYS,
  windowCoveredDays: Number(elapsedDays.toFixed(2)),
  youngWindow: elapsedDays < WINDOW_DAYS,
  probes: windowed.length,
  failures,
  downtimeMinutes: Number(downtimeMinutes.toFixed(1)),
  budgetMinutes: Number(allowedDowntimeMinutes.toFixed(1)),
  budgetRemainingMinutes: Number(remaining.toFixed(1)),
  projectedDowntimeMinutes: Number(projectedDowntime.toFixed(1)),
  exhausted: remaining < 0,
  willExhaust: projectedDowntime > allowedDowntimeMinutes && remaining >= 0,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `slo: ${report.probes} probe(s) over ${report.windowCoveredDays}d, target ${(TARGET * 100).toFixed(1)}% — ` +
      `${report.downtimeMinutes} of ${report.budgetMinutes} min downtime used, ${Math.max(0, report.budgetRemainingMinutes)} min left` +
      (report.youngWindow ? ` (window is ${report.windowCoveredDays} of ${WINDOW_DAYS} days — budget scales with time, not probes)` : ""),
  );
}

if (report.exhausted) {
  console.error(`slo: BUDGET SPENT — ${report.downtimeMinutes} min of downtime against an allowance of ${report.budgetMinutes} min`);
  process.exit(1);
}
if (report.willExhaust) {
  console.error(
    `slo: budget will be spent before the window closes at this rate ` +
      `(projected ${report.projectedDowntimeMinutes} min vs ${report.budgetMinutes} allowed)`,
  );
  process.exit(1);
}
process.exit(0);
