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
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const shallow = join(ROOT, ".git/shallow");

if (!existsSync(join(ROOT, ".git"))) {
  console.error("repo-depth: not a git checkout");
  process.exit(11);
}
if (existsSync(shallow)) {
  const n = execFileSync("bash", ["-c", `wc -l < ${JSON.stringify(shallow)}`], { encoding: "utf8" }).trim();
  console.error(`repo-depth: this checkout is SHALLOW (${n} boundaries) — history-based checks would report gaps as facts`);
  console.error("repo-depth: run `git fetch --unshallow` before trusting commit counts or deployable-path diffs");
  process.exit(10);
}
const count = execFileSync("git", ["-C", ROOT, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
console.log(`repo-depth: full history, ${count} commits reachable`);
