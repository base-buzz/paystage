#!/usr/bin/env node
/**
 * A script must not hardcode the container's checkout path.
 *
 *   node scripts/check-hardcoded-paths.mjs
 *
 * Exit 0 clean · 1 a literal container path in code · 2 a file could not be read.
 *
 * Why this exists, 2026-11-25: `check-doc-links.mjs` and `check-provenance-wording.mjs` both had
 * `const ROOT = "/work/paystage"`. In this container that is the repo, so both checks passed at pre-push; on a
 * GitHub runner the directory does not exist, so every CI run since they landed died with
 * `ENOENT: scandir '/work/paystage/apps/console/src'` — nine red runs, and nobody read them because the hook had
 * said green. A local check that cannot run where CI runs is worse than no check: it converts "unknown" into
 * "verified".
 *
 * An environment-variable default (`process.env.PAYSTAGE_REPO ?? "/work/paystage"`) is allowed and must be marked
 * with `hardcoded-path-ok` on the line, because there the container path is a fallback the operator can override.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_DIRS = ["scripts", "apps/hosted/scripts", "apps/console/scripts"];
/**
 * Only the repo root is guarded. `/work/ops` is deliberately exempt: it is the operator's tree, it does not exist on
 * a runner, and the scripts that default to it are operator tools that never run in CI. The defect this catches is
 * narrower and was real — a **check CI runs** pointing at a directory CI does not have.
 */
const CONTAINER_PATHS = ["/work/paystage"]; // hardcoded-path-ok
const ALLOW = "hardcoded-path-ok";

const files = [];
for (const dir of SCRIPT_DIRS) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    continue; // a directory that does not exist is not a finding
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.(mjs|js|sh)$/.test(entry.name)) files.push(join(dir, entry.name));
  }
}

const problems = [];
for (const rel of files) {
  let text;
  try {
    text = readFileSync(join(ROOT, rel), "utf8");
  } catch {
    problems.push(`${rel}: unreadable`);
    continue;
  }
  text.split("\n").forEach((line, i) => {
    if (line.includes(ALLOW)) return;
    if (/^\s*(\*|\/\/|#)/.test(line)) return; // a comment may name the path; code may not depend on it
    for (const p of CONTAINER_PATHS) {
      if (line.includes(`"${p}`) || line.includes(`'${p}`) || line.includes(`=${p}`)) {
        problems.push(`${rel}:${i + 1} hardcodes ${p} — derive it from the file's own location, or mark a deliberate env default with "${ALLOW}"`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`hardcoded-paths: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  console.error("  why: a check that only runs in this container is red in CI on every push and looks green here.");
  process.exit(1);
}

console.log(`hardcoded-paths: ${files.length} script(s), no container path baked into code`);
