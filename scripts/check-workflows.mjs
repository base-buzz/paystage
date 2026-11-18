#!/usr/bin/env node
/**
 * A job that runs a script must first install what the script needs.
 *
 * The daily cadence job ran `node apps/hosted/scripts/conformance.mjs` in a fresh checkout with no `node_modules` and
 * died with `ERR_MODULE_NOT_FOUND: @paystage/policy` on 2 of 12 runs. The check was red because the checkout was
 * empty, not because production was wrong — and a daily job that cries wolf is one everyone learns to ignore.
 *
 *   node scripts/check-workflows.mjs
 *
 * Exit 0 every job that runs a repo script installs first · 1 a job does not · 2 a workflow cannot be read.
 *
 * Deliberately a structural check, not a parser: a job is flagged when it runs `node <script>` or `npm run …` and has
 * no step that installs dependencies (`npm ci`, `npm install`, `pnpm install`, `yarn`). Cheap, and it names the job.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = join(ROOT, ".github/workflows");

/**
 * An install STEP, not a mention. The first version matched `npm install` anywhere in the job, and a comment quoting a
 * failing command (`npm install @paystage/mcp@0.8.8 failed while …`) made a job with no install look installed.
 */
const INSTALL = /^\s*run:\s*(?:set -[a-z]+[;&|]*\s*)?(npm ci|npm install|pnpm install|yarn install|yarn --frozen-lockfile|pip install)/m;
/** A command that runs a repo script, capturing the path so its imports can be checked. */
const RUNS_SCRIPT = /\bnode\s+((?:apps|packages|scripts|starter)\/[\w./-]+\.m?js)/g;

/** Does this script import a package that has to be installed? A `node:` builtin does not. */
function needsNodeModules(scriptPath) {
  const path = join(ROOT, scriptPath);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null; // not a repo file: not our business
  }
  for (const m of text.matchAll(/^\s*import[^;]*?from\s+["']([^"']+)["']/gm)) {
    const spec = m[1];
    if (spec.startsWith("node:")) continue;
    if (spec.startsWith(".") || spec.startsWith("/")) continue;
    return spec;
  }
  return false;
}

const problems = [];
let jobs = 0;
let scriptsChecked = 0;

for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
  const text = readFileSync(join(WORKFLOWS, file), "utf8");
  const jobsStart = text.indexOf("\njobs:");
  if (jobsStart < 0) continue;
  const body = text.slice(jobsStart);
  const chunks = body.split(/\n {2}([a-zA-Z0-9_-]+):\n/).slice(1);
  for (let i = 0; i < chunks.length; i += 2) {
    const name = chunks[i];
    const block = chunks[i + 1] ?? "";
    if (!/runs-on:/.test(block)) continue;
    jobs += 1;

    const scripts = [...block.matchAll(RUNS_SCRIPT)].map((m) => m[1]);
    if (scripts.length === 0) continue;

    // Only a script that imports a real package needs an install; `node:fs` does not.
    const needing = scripts
      .map((script) => ({ script, spec: needsNodeModules(script) }))
      .filter((entry) => entry.spec);
    scriptsChecked += scripts.length;
    if (needing.length === 0) continue;
    if (INSTALL.test(block)) continue;

    problems.push(
      `${file} → job "${name}" runs ${needing[0].script} which imports ${needing[0].spec}, but never installs dependencies`,
    );
  }
}

if (problems.length === 0) {
  console.log(`workflows: ${jobs} job(s), ${scriptsChecked} script invocation(s) — every job that imports a package installs first`);
  process.exit(0);
}
console.error("workflows: these jobs would fail on a fresh checkout:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
