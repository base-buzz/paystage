#!/usr/bin/env node
/**
 * Wait for the CI runs of one commit and report a verdict.
 *
 *   node scripts/await-ci.mjs                 # HEAD
 *   node scripts/await-ci.mjs 444b790         # a sha or a prefix
 *   node scripts/await-ci.mjs --timeout 900   # seconds, default 600
 *   node scripts/await-ci.mjs --json
 *
 * Exit 0 every completed run for that commit succeeded · 1 at least one failed · 2 no runs appeared in time or the
 * query failed · 3 still running when the timeout expired.
 *
 * Why this exists (#439, 2026-11-25): nine consecutive CI runs on `main` were red while `pre-push` printed green,
 * because two checks hardcoded a path that exists only in this container. Nobody read the runs, so "pushed" was
 * reported as "shipped" nine times. A hook cannot see the runner: the last fifty metres — push, read the result, say
 * what happened — have to be a step, not a hope.
 *
 * The push and the deploy are also different events: a green `ci` with `deploy-console` still running means the live
 * site is the previous build. This waits for **every** run on the commit, so a deploy that failed or never started is
 * not mistaken for a finished one.
 */
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const asJson = argv.includes("--json");
const timeoutSec = Number(flag("timeout", 600));
const shaArg = argv.find((a) => !a.startsWith("--") && a !== flag("timeout", null));
const sha = (shaArg ?? "HEAD").trim();

const fail = (code, message, extra = {}) => {
  if (asJson) console.log(JSON.stringify({ ok: false, sha, code, message, ...extra }));
  else console.error(`await-ci: ${message}`);
  process.exit(code);
};

/** The full sha for a prefix, so a short sha cannot match a different commit. */
function resolveSha(ref) {
  try {
    return execFileSync("git", ["rev-parse", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const full = resolveSha(sha);
if (!full) fail(2, `${sha} is not a commit in this repo`);

const gh = (args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    fail(2, `gh ${args.join(" ")} failed: ${String(error?.stderr ?? error.message).trim().slice(0, 200)}`);
  }
};

const started = Date.now();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let last = "";

for (;;) {
  const raw = gh(["run", "list", "--commit", full, "--limit", "30", "--json", "name,status,conclusion,workflowName"]);
  let runs = [];
  try {
    runs = JSON.parse(raw);
  } catch {
    fail(2, "could not parse `gh run list` output");
  }

  if (runs.length === 0) {
    if (Date.now() - started > 120_000) fail(2, `no CI run appeared for ${full.slice(0, 12)} within 2 minutes`);
    sleep(10_000);
    continue;
  }

  const pending = runs.filter((r) => r.status !== "completed");
  const failed = runs.filter((r) => r.status === "completed" && r.conclusion !== "success");
  const summary = runs.map((r) => `${r.name ?? r.workflowName}: ${r.conclusion ?? r.status}`).join(" · ");

  if (pending.length === 0) {
    if (failed.length === 0) {
      if (asJson) console.log(JSON.stringify({ ok: true, sha: full, runs: runs.length, summary }));
      else console.log(`await-ci: ${full.slice(0, 12)} — ${runs.length} run(s) green (${summary})`);
      process.exit(0);
    }
    if (asJson) console.log(JSON.stringify({ ok: false, sha: full, code: 1, failed: failed.map((r) => r.name ?? r.workflowName), summary }));
    else console.error(`await-ci: ${full.slice(0, 12)} RED — ${failed.map((r) => r.name ?? r.workflowName).join(", ")} (${summary})`);
    process.exit(1);
  }

  if (Date.now() - started > timeoutSec * 1000) {
    if (asJson) console.log(JSON.stringify({ ok: false, sha: full, code: 3, pending: pending.map((r) => r.name ?? r.workflowName), summary }));
    else console.error(`await-ci: ${full.slice(0, 12)} still running after ${timeoutSec}s — ${pending.map((r) => r.name ?? r.workflowName).join(", ")}`);
    process.exit(3);
  }

  if (summary !== last) {
    if (!asJson) console.log(`await-ci: waiting on ${full.slice(0, 12)} — ${summary}`);
    last = summary;
  }
  sleep(15_000);
}
