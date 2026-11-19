#!/usr/bin/env node
/**
 * Refuse to reason about history from a shallow clone.
 *
 * Twice on 2026-11-19 a missing history object looked like a fact rather than a gap: the note read ~40 commits as 2, and a deploy check reported a commit whose
 * local diff claimed 474 files where GitHub showed 2 — git was comparing against nothing and calling it a big commit.
 *
 *   node scripts/check-repo-depth.mjs
 *
 * Exit 0 full history · 10 shallow (run `git fetch --unshallow`) · 11 not a git checkout.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const shallow = join(ROOT, ".git/shallow");

if (!existsSync(join(ROOT, ".git"))) {
  console.error("repo-depth: not a git checkout");
  process.exit(11);
}
/**
 * A script that fetches with `--depth` shallow-ens the caller's checkout — which is how this repository became shallow twice in one day, truncating a note's commit list
 * and making a two-file commit look like 474 files. The guard reads the scripts, so re-introducing one fails here rather than in a report three hours later.
 */
import { readdirSync } from "node:fs";
const offending = [];
for (const file of readdirSync(join(ROOT, "scripts"))) {
  if (!file.endsWith(".mjs")) continue;
  const text = readFileSync(join(ROOT, "scripts", file), "utf8");
  // `fetch --depth` shallow-ens the checkout; a comment mentioning it is fine, a flag is not.
  if (/git["'],\s*\[[^\]]*["']fetch["'][^\]]*["']--depth/.test(text) || /fetch[^\n]*--depth=[0-9]/.test(text.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    offending.push(file);
  }
}
for (const file of readdirSync(join(ROOT, ".github", "workflows"))) {
  if (!file.endsWith(".yml")) continue;
  const text = readFileSync(join(ROOT, ".github", "workflows", file), "utf8");
  if (text.includes("fetch-depth: 1") || /git fetch[^\n]*--depth/.test(text)) offending.push(`.github/workflows/${file}`);
}
if (offending.length > 0) {
  console.error(`repo-depth: these scripts fetch with --depth and would shallow the checkout: ${offending.join(", ")}`);
  process.exit(10);
}

if (existsSync(shallow)) {
  const n = execFileSync("bash", ["-c", `wc -l < ${JSON.stringify(shallow)}`], { encoding: "utf8" }).trim();
  console.error(`repo-depth: this checkout is SHALLOW (${n} boundaries) — history-based checks would report gaps as facts`);
  console.error("repo-depth: run `git fetch --unshallow` before trusting commit counts or deployable-path diffs");
  process.exit(10);
}
const count = execFileSync("git", ["-C", ROOT, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
console.log(`repo-depth: full history, ${count} commits reachable`);
