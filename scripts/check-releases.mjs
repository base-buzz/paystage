#!/usr/bin/env node
/**
 * The newest tag has a GitHub Release (#release-plane, 2026-11-28).
 *
 * For fifteen days every mirror that reads GitHub Releases rather than tags saw nothing: the last Release was `v2026.11.13-r3` while the
 * repository carried three newer tags. Glama mirrors Releases, which is why our MCP server was reported missing from its listing while the tag
 * existed — a mirror that stops updating looks exactly like a mirror that works.
 *
 *   node scripts/check-releases.mjs            # newest tag on origin
 *   node scripts/check-releases.mjs --tag v…   # a specific tag
 *
 * Exit 0 the tag has a Release · 10 it does not · 2 git or gh could not be asked.
 *
 * Runs daily rather than per-PR: a missing Release is a publishing-plane problem and must not block a merge, which is why it is wired into the
 * cadence workflow instead of `ci.yml`.
 */
import { execFileSync } from "node:child_process";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 60_000 }).trim();

let tag = arg("tag");
if (!tag) {
  try {
    run("git", ["fetch", "--tags", "--quiet", "origin"]);
    tag = run("bash", ["-c", "git describe --tags --abbrev=0 $(git rev-list --tags --max-count=1)"]);
  } catch (error) {
    console.error(`releases: could not read the newest tag (${String(error?.message ?? error).slice(0, 120)})`);
    process.exit(2);
  }
}
if (!tag) {
  console.error("releases: no tags found — nothing to compare against");
  process.exit(2);
}

let hasRelease = false;
try {
  run("gh", ["release", "view", tag]);
  hasRelease = true;
} catch (error) {
  const text = `${error?.stderr ?? ""}${error?.stdout ?? ""}`;
  if (/release not found|not found/i.test(text)) hasRelease = false;
  else if (/command not found|gh: not found/i.test(text)) {
    console.error("releases: gh is not available");
    process.exit(2);
  }
}

if (hasRelease) {
  console.log(`releases: ${tag} has a GitHub Release`);
  process.exit(0);
}

console.log(`releases: ${tag} is tagged but has NO GitHub Release, so every mirror that reads Releases saw nothing since the last one`);
console.log(`  fix: gh release create ${tag} --notes-file releases/${tag}.md --verify-tag`);
process.exit(10);
