#!/usr/bin/env node
/**
 * A canary badge can lie in two ways: by showing tag runs (tag runs publish `latest`, not `canary`), and by showing a date someone typed
 * (it keeps looking current after the daily publish has stopped).
 *
 * The status badge, when it exists, must stay pinned to `event=schedule`. The date badge (#318) is a shields `endpoint` badge reading
 * `badges/canary.json` on the dedicated `badges` branch — rewritten by the scheduled release run after a successful canary publish — so this
 * checks the URL it reads, the payload contract the workflow writes, and that the README carries no literal date in a badge at all.
 *
 *   node scripts/check-canary-badge.mjs             # README, the payload writer and the workflow wiring — offline
 *   node scripts/check-canary-badge.mjs --network   # also fetch the JSON the badge URL actually serves
 *
 * Exit 0 every canary badge is generated · 1 one would tell a reader the wrong thing · 2 there is no canary badge (the parse is wrong, or the
 * badge was removed).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
const GENERATOR = join(ROOT, "scripts/write-canary-badge.mjs");
const RAW_CANARY_JSON = "https://raw.githubusercontent.com/base-buzz/paystage/badges/canary.json";
const network = process.argv.includes("--network");

const images = [...readme.matchAll(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g)].map((m) => ({
  alt: m[1],
  url: m[2],
}));
const problems = [];

/**
 * A status badge for the release workflow is allowed, but only event-filtered. Unfiltered, it reports v* tag runs — which publish `latest`, not
 * `canary` — as if they were the daily canary. This is the failure the check was written for; it stays.
 */
const statusBadges = images.filter(
  ({ url }) => /release\.yml/.test(url) && /[?&]label=canary(?:%20|&|$)/.test(url),
);
for (const { url } of statusBadges) {
  if (!/[?&]event=schedule(?:&|$)/.test(url)) {
    problems.push(`${url} has no event=schedule filter — an unfiltered release badge also reports v* tag runs`);
  }
}

/** The date badge, and the branch it reads. A date in the image URL would be a string no run ever updates. */
const dateBadges = images.filter(({ url }) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "img.shields.io" || parsed.pathname !== "/endpoint") return false;
    return parsed.searchParams.get("url") === RAW_CANARY_JSON;
  } catch {
    return false;
  }
});

if (statusBadges.length === 0 && dateBadges.length === 0) {
  console.error("canary-badge: no canary badge in README.md — neither an event=schedule status badge nor an endpoint date badge reading badges/canary.json");
  console.error("  the parse is wrong, or the canary badge was removed");
  process.exit(2);
}
if (dateBadges.length === 0) {
  problems.push(`no endpoint date badge reading ${RAW_CANARY_JSON} — the canary needs a date a run writes, not only a status badge`);
}
if (dateBadges.length > 1) {
  problems.push(`${dateBadges.length} canary date badges read the same JSON — one is enough, and duplicates can drift apart`);
}

/**
 * Any date in a badge is a lie with a timestamp on it: nothing rewrites it. This is the assertion that fails when someone "fixes" the date badge by
 * types the date into the README instead of reading the JSON.
 */
for (const { alt, url } of images) {
  const literal = /20\d{2}[-\u2013]\d{2}/.test(alt) || /20\d{2}[-\u2013]\d{2}/.test(url) || /20\d{2}--\d{2}/.test(url);
  if (literal) {
    problems.push(`badge "${alt}" carries a literal date — the canary date must come from ${RAW_CANARY_JSON}, never from the README: ${url}`);
  }
}

/** The link has to land on the scheduled runs, where a reader can see the publish the date names. */
const links = [...readme.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
const runList = links.some(
  (url) =>
    /github\.com\/base-buzz\/paystage\/actions\/workflows\/release\.yml/.test(url) &&
    /[?&]query=event(?:%3A|:)schedule/.test(url),
);
if (!runList) {
  problems.push("no link to the scheduled release-run list (actions/workflows/release.yml?query=event%3Aschedule)");
}

/**
 * The payload the badge reads is written by scripts/write-canary-badge.mjs on the scheduled run. Run it and check what it emits: a schema shields
 * accepts, a message that is a date from this run and not a constant. Then check the workflow still points it at the path the README reads, and
 * only on the scheduled path.
 */
if (!/write-canary-badge\.mjs[^\n]*\bcanary\.json/.test(workflow)) {
  problems.push("release.yml does not run scripts/write-canary-badge.mjs into canary.json (the branch root) — the badge would never update");
}
if (!/if:\s*github\.event_name\s*==\s*'schedule'/.test(workflow)) {
  problems.push("release.yml's canary badge job is not restricted to schedule runs — a tag run would stamp a stable release as the canary date");
}
if (!/push origin HEAD:badges/.test(workflow) || !/ref:\s*badges/.test(workflow)) {
  problems.push("release.yml does not push the badge JSON to the `badges` branch — the URL shields reads would stay at its first value");
}

const generator = readFileSync(GENERATOR, "utf8");
if (/20\d{2}-\d{2}-\d{2}/.test(generator)) {
  problems.push("scripts/write-canary-badge.mjs contains a literal date — the date must be the clock at publish time");
}

const tmp = mkdtempSync(join(tmpdir(), "canary-badge-"));
try {
  const out = join(tmp, "canary.json");
  execFileSync(process.execPath, [GENERATOR, out], { cwd: ROOT, stdio: "pipe", encoding: "utf8" });
  const payload = JSON.parse(readFileSync(out, "utf8"));
  if (payload.schemaVersion !== 1) problems.push(`badge JSON schemaVersion is ${payload.schemaVersion}, shields endpoint badges need 1`);
  if (typeof payload.label !== "string" || !/canary/i.test(payload.label)) problems.push("badge JSON label does not say canary");
  if (typeof payload.color !== "string" || payload.color.length === 0) problems.push("badge JSON has no color");
  if (typeof payload.cacheSeconds !== "number") problems.push("badge JSON has no numeric cacheSeconds — shields would cache the date for as long as it likes");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.message ?? "")) {
    problems.push(`badge JSON message is ${JSON.stringify(payload.message)}, expected a YYYY-MM-DD date`);
  } else {
    const stamped = Date.parse(`${payload.message}T00:00:00Z`);
    const ageDays = (Date.now() - stamped) / 86_400_000;
    if (ageDays < -1) problems.push(`badge JSON message ${payload.message} is in the future`);
    if (ageDays > 1) problems.push(`badge JSON message ${payload.message} is not this run's date — the writer is not using the clock`);
  }
} catch (error) {
  problems.push(`scripts/write-canary-badge.mjs did not produce a JSON payload: ${String(error.message).slice(0, 120)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * Offline the URL is checked for shape; `--network` proves it resolves. It is a separate mode because the `badges` branch is a one-time setup step
 * taken by the operator: until it exists the raw URL is a 404, and this check says exactly that rather than passing quietly.
 */
if (network) {
  try {
    const res = await fetch(RAW_CANARY_JSON, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!res.ok) {
      problems.push(`${RAW_CANARY_JSON} -> HTTP ${res.status} — the badge cannot render; create the unprotected \`badges\` branch with badges/canary.json`);
    } else {
      const served = await res.json();
      if (served.schemaVersion !== 1) problems.push(`served badge JSON schemaVersion is ${served.schemaVersion}, shields needs 1`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(served.message ?? "")) {
        problems.push(`served badge JSON message is ${JSON.stringify(served.message)}, expected a YYYY-MM-DD date`);
      } else {
        const ageDays = (Date.now() - Date.parse(`${served.message}T00:00:00Z`)) / 86_400_000;
        if (ageDays < -1) problems.push(`served canary date ${served.message} is in the future`);
        if (ageDays > 3) problems.push(`served canary date ${served.message} is ${Math.floor(ageDays)} days old — the daily canary has not published`);
      }
    }
  } catch (error) {
    problems.push(`${RAW_CANARY_JSON} -> ${String(error).slice(0, 80)} — the badge cannot render`);
  }
}

for (const p of problems) console.error(`  FAIL ${p}`);
if (problems.length > 0) {
  console.error("canary-badge: the canary badge would tell a reader the wrong thing");
  process.exit(1);
}
console.log(
  `canary-badge: date badge reads ${RAW_CANARY_JSON}, the writer stamps this run's date, the URL is linked to the scheduled runs${
    network ? ", and the JSON resolves" : ""
  }`,
);
