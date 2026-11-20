#!/usr/bin/env node
/**
 * The canary date badge's payload — the one badge in the README that must be a fact from the last scheduled run, not a string someone typed.
 *
 * `release.yml` publishes the daily canary at 09:00 NZDT. After that publish succeeds, the `badge-canary` job runs this script and pushes the
 * result to the `badges` branch, which is deliberately unprotected (branch protection refuses a `github-actions[bot]` push to `main`). Shields
 * reads the file with an `endpoint` badge:
 *
 *   https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/base-buzz/paystage/badges/canary.json
 *
 * The date is the UTC date on which the scheduled publish ran. Using the run's own clock is the point: a failed or skipped run leaves the previous
 * date standing, so the badge ages visibly instead of lying convincingly.
 *
 *   node scripts/write-canary-badge.mjs badges/canary.json
 *
 * Exit 0 wrote the file · 2 no output path given.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/write-canary-badge.mjs <output.json>");
  process.exit(2);
}

const now = new Date();
const date = now.toISOString().slice(0, 10);

const payload = {
  schemaVersion: 1,
  label: "canary last published",
  message: date,
  color: "blue",
  // Shields may cache an endpoint payload; half an hour means a missed run shows up the same working day rather than the next one.
  cacheSeconds: 1800,
};

const target = resolve(out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`canary-badge: wrote ${out} — canary last published ${date} (UTC)`);
