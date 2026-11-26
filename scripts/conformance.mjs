#!/usr/bin/env node
/**
 * `npm run conformance` — run the existing fixture kit and reduce it to one line.
 *
 * The kit itself is `scripts/conformance-fixtures.mjs` (a thin wrapper over
 * `apps/hosted/scripts/conformance.mjs`); this file does not re-implement any check. It
 * exists so a forker has one documented command at the repo root, with a pass/fail line
 * that carries a count and a non-zero exit code on failure.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER = "scripts/conformance-fixtures.mjs";

const result = spawnSync(process.execPath, [resolve(ROOT, WRAPPER)], {
  cwd: ROOT,
  encoding: "utf8",
});

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const count = output.match(/(\d+)\/(\d+)\s+passed/);
const passed = count ? Number(count[1]) : 0;
const total = count ? Number(count[2]) : 0;
const passedAll = result.status === 0 && total > 0 && passed === total;

if (passedAll) {
  console.log(`conformance: PASS ${passed}/${total}`);
  process.exit(0);
}

const status = result.status ?? "killed";
console.log(`conformance: FAIL ${passed}/${total || "?"} — the fixture kit exited ${status}`);
for (const line of output.trim().split("\n").slice(-8)) console.error(line);
process.exit(result.status ?? 1);
