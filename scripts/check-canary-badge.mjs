#!/usr/bin/env node
/**
 * A canary badge that silently shows tag runs is worse than no badge: tag runs publish `latest`, not `canary`.
 *
 * The release workflow serves two audiences — `v*` tags for stable releases and `schedule` for the daily canary.
 * The badge must be pinned to `event=schedule`, and its link must land on the scheduled-run list so a reader can
 * reach the run that published the version named by the npm canary badge.
 *
 *   node scripts/check-canary-badge.mjs
 *
 * Exit 0 the badge is event-filtered and linked to scheduled runs · 1 the filter or link was removed · 2 no canary badge found.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

const canaryBadges = [...readme.matchAll(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g)]
  .map((m) => m[1])
  .filter((url) => /release\.yml/.test(url) && /[?&]label=canary(?:%20|&|$)/.test(url));

if (canaryBadges.length === 0) {
  console.error("canary-badge: no release-workflow badge labelled canary in README.md — the parse is wrong, or the canary badge was removed");
  process.exit(2);
}

const problems = [];
for (const url of canaryBadges) {
  if (!/[?&]event=schedule(?:&|$)/.test(url)) {
    problems.push(`${url} has no event=schedule filter — an unfiltered release badge also reports v* tag runs`);
  }
}

const links = [...readme.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
const runList = links.some(
  (url) =>
    /github\.com\/base-buzz\/paystage\/actions\/workflows\/release\.yml/.test(url) &&
    /[?&]query=event(?:%3A|:)schedule/.test(url),
);
if (!runList) {
  problems.push("no link to the scheduled release-run list (actions/workflows/release.yml?query=event%3Aschedule)");
}

for (const p of problems) console.error(`  FAIL ${p}`);
if (problems.length > 0) {
  console.error("canary-badge: the canary badge would tell a reader the wrong thing");
  process.exit(1);
}
console.log("canary-badge: event=schedule filter present, link points at the scheduled release runs");
