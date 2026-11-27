#!/usr/bin/env node
/**
 * One command for a brand change, in the order that actually works.
 *
 * The previous process was five commands in a remembered order, and the failure was never a command that did not exist:
 * it was a half-run that looked finished, with the old mark still in the wallet. This runs every generator, hashes the
 * result, runs both checks, re-signs the demo pass, and records the final ledger — **aborting at the first failure**, so a
 * later step cannot paper over an earlier one.
 *
 *   1. brand kit (mark tiers, lockups, favicons, OG, sheet)
 *   2. pass assets (face, strip, icon, state marks)
 *   3. storyboard frames (same layout functions, into the mock surface)
 *   4. loop frames and stills
 *   5. record the asset ledger
 *   6. check-brand-assets (five geometry checks + freshness)
 *   7. check-pass-assets (Apple sizes + the poster mark)
 *   8. re-sign the demo .pkpass
 *   9. record the ledger again, so the signed archive is the one on record
 *
 *   npm run brand:rebuild
 *
 * Exit 0 every step ran and both checks pass · 1 the first failing step (its output is above).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const STEPS = [
  { label: "kit", args: ["scripts/brand-kit.mjs"] },
  { label: "pass assets", args: ["scripts/render-pass-assets.mjs"] },
  { label: "storyboard frames", args: ["scripts/render-pass-assets.mjs", "--out", "apps/console/public/mocks", "--frames"] },
  { label: "loop", args: ["scripts/render-loop.mjs", "--no-check"] },
  { label: "record ledger", args: ["scripts/record-brand-manifest.mjs"] },
  { label: "check brand", args: ["scripts/check-brand-assets.mjs"] },
  { label: "check pass", args: ["scripts/check-pass-assets.mjs"] },
  { label: "re-sign demo pass", args: ["scripts/sign-demo-pass.mjs"] },
  { label: "record signed ledger", args: ["scripts/record-brand-manifest.mjs"] },
];

const startedAll = Date.now();
const results = [];
for (const step of STEPS) {
  const script = step.args[0];
  if (!existsSync(script)) {
    console.error(`brand:rebuild: ${step.label}: ${script} is missing`);
    process.exit(1);
  }
  const started = Date.now();
  console.log(`\nbrand:rebuild → ${step.label}  (node ${step.args.join(" ")})`);
  const result = spawnSync(process.execPath, step.args, { stdio: "inherit", encoding: "utf8" });
  const seconds = (Date.now() - started) / 1000;
  if (result.error || result.status !== 0) {
    const why = result.error ? result.error.message : `exit ${result.status}`;
    console.error(`\nbrand:rebuild: ${step.label} FAILED (${why}) after ${seconds.toFixed(1)}s — stopping; nothing after this ran`);
    process.exit(result.status && result.status > 0 ? result.status : 1);
  }
  results.push({ label: step.label, seconds });
  console.log(`brand:rebuild: ${step.label} ok (${seconds.toFixed(1)}s)`);
}

const total = (Date.now() - startedAll) / 1000;
console.log(`\nbrand:rebuild: all ${results.length} steps passed in ${total.toFixed(1)}s`);
for (const result of results) console.log(`  ${result.label.padEnd(20)} ${result.seconds.toFixed(1)}s`);
