#!/usr/bin/env node
/**
 * Is the deployed site running the commit we think it is?
 *
 * Only commits that touch a deployable path can move the site: `deploy-console` triggers on `apps/console`, `apps/hosted`, `packages`
 * and its own workflow file. Comparing against HEAD flagged a false positive within the hour — a scripts-only push left the site
 * "behind" while it was exactly current, which is how a real deploy failure would get ignored.
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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REMOTE = process.argv.includes("--remote");

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Only commits that touch a deployable path can move the site (`deploy-console`'s trigger). Comparing against HEAD reported the site
 * as behind within the hour of the check shipping — a scripts-only push left it "stale" while it was exactly current, which is how a
 * real deploy failure gets trained away.
 */
const DEPLOYABLE = ["apps/console", "apps/hosted", "packages", ".github/workflows/deploy-console.yml"];
const git = (args) => execFileSync("git", args, { encoding: "utf8", cwd: REPO }).trim();

let expected;
let branch;
try {
  branch = REMOTE ? "origin/main" : "HEAD";
  expected = git(["rev-parse", branch]);
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
  // Is the difference something that would actually rebuild the site?
  let behind = "?";
  try {
    behind = git(["rev-list", "--count", `${deployed}..${branch}`, "--", ...DEPLOYABLE]);
  } catch {
    behind = "?";
  }
  if (behind === "0") {
    console.log(
      `deployed-sha: site is at ${deployed.slice(0, 8)}, ${branch} is ${expected.slice(0, 8)} — no deployable change in between, so the site is current`,
    );
    process.exit(0);
  }
  console.error(
    `deployed-sha: site is running ${deployed.slice(0, 8)}, ${branch} is ${expected.slice(0, 8)} — ${behind} deployable commit(s) behind`,
  );
  process.exit(10);
}
console.log(`deployed-sha: site and ${REMOTE ? "origin/main" : "HEAD"} agree at ${deployed.slice(0, 8)} (built ${stamp.built_at ?? "unknown"}, ${stamp.source ?? "?"})`);
