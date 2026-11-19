#!/usr/bin/env node
/**
 * Is the deployed site running the commit we think it is?
 *
 * `/api/build` publishes the SHA baked into the deployment (added 2026-11-19 after a green deploy of a commit that never left the
 * machine). This compares it against the repository's HEAD, so "the deploy was green" stops being the same sentence as "the change
 * is live".
 *
 *   node scripts/check-deployed-sha.mjs              # compare against HEAD
 *   node scripts/check-deployed-sha.mjs --remote     # compare against origin/main (what CI deploys)
 *
 * Exit 0 deployed SHA matches · 10 it does not (the site is behind or ahead) · 11 the stamp is unreadable.
 */
import { execFileSync } from "node:child_process";

const REMOTE = process.argv.includes("--remote");

const git = (args) => execFileSync("git", args, { encoding: "utf8", cwd: "/work/paystage" }).trim();
let expected;
try {
  expected = REMOTE ? git(["rev-parse", "origin/main"]) : git(["rev-parse", "HEAD"]);
} catch {
  console.error("deployed-sha: cannot read git — is this the repo?");
  process.exit(11);
}

let stamp;
try {
  const res = await fetch("https://paystage.xyz/api/build", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  stamp = await res.json();
} catch (error) {
  console.error(`deployed-sha: cannot read the stamp — ${String(error).slice(0, 80)}`);
  process.exit(11);
}

const deployed = String(stamp.sha ?? "");
if (!deployed || deployed === "unknown") {
  console.error("deployed-sha: the deployment carries no commit — it was not built by CI");
  process.exit(10);
}
if (deployed !== expected) {
  console.error(`deployed-sha: site is running ${deployed.slice(0, 8)}, ${REMOTE ? "origin/main" : "HEAD"} is ${expected.slice(0, 8)} — the deploy is behind (or built from another branch)`);
  process.exit(10);
}
console.log(`deployed-sha: site and ${REMOTE ? "origin/main" : "HEAD"} agree at ${deployed.slice(0, 8)} (built ${stamp.built_at ?? "unknown"}, ${stamp.source ?? "?"})`);
