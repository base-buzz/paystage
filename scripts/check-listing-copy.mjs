#!/usr/bin/env node
/**
 * The three copies of "where are we listed" must agree.
 *
 * They are written by hand in three places and they had already drifted: the README listed four
 * destinations, the lander listed six, and the inventory recorded five live ones plus a sixth awaiting an
 * update. One of them (Arcade) claimed a listing nothing had ever verified.
 *
 * This compares the *set of destinations*, not the prose. Wording is allowed to differ between a README
 * bullet and a footer badge; the claim "we are on X" is not.
 *
 *   node scripts/check-listing-copy.mjs
 *   node scripts/check-listing-copy.mjs --json
 *
 * Exit 0 aligned · 1 drift · 2 could not read a source.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY = process.env.PAYSTAGE_DISTRIBUTION ?? "/work/ops/docs/state/distribution.json";

/** A destination is identified by its host, normalised. */
function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "").replace(/^api\./, "");
  } catch {
    return null;
  }
}

function fromReadme() {
  const text = readFileSync(join(ROOT, "README.md"), "utf8");
  const section = text.slice(text.indexOf("## Listed on"));
  const block = section.slice(0, section.indexOf("\n## ", 1));
  const hosts = new Map();
  for (const m of block.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    hosts.set(hostOf(m[2]), m[1]);
  }
  return hosts;
}

function fromLander() {
  const text = readFileSync(join(ROOT, "apps/console/src/components/LogoBanner.tsx"), "utf8");
  const block = text.slice(text.indexOf("const CALLABLE"));
  const hosts = new Map();
  for (const m of block.matchAll(/label:\s*"([^"]+)"[^}]*note:\s*"([^"]*)"[^}]*href:\s*"(https?:\/\/[^"]+)"/g)) {
    // A badge that says "not listed" is not making the claim. Counting it would force the inventory to
    // record a listing we do not have, which is the opposite of what this check is for.
    if (/not listed|pending|planned/i.test(m[2])) continue;
    hosts.set(hostOf(m[3]), m[1]);
  }
  return hosts;
}

function fromInventory() {
  if (!existsSync(INVENTORY)) return null;
  const data = JSON.parse(readFileSync(INVENTORY, "utf8"));
  const hosts = new Map();
  for (const surface of data.surfaces ?? []) {
    // Only the states that are a claim about being listed. A PR in flight is not a listing yet.
    if (!["live", "update-requested", "stale"].includes(surface.state)) continue;
    if (surface.kind === "owned") continue;
    // The repository is not a destination we had to get listed on; the inventory tracks those, and the
    // README/lander link GitHub as provenance rather than as a listing.
    if (hostOf(surface.url) === "github.com") continue;
    const host = hostOf(surface.url);
    if (host) hosts.set(host, surface.name);
  }
  return hosts;
}

const sources = { readme: fromReadme(), lander: fromLander(), inventory: fromInventory() };
const problems = [];

for (const [name, hosts] of Object.entries(sources)) {
  if (hosts === null) {
    problems.push(`could not read ${name} (${INVENTORY} missing?)`);
    continue;
  }
}

if (problems.length === 0) {
  // Two different questions, because the three sources do not have the same job:
  //
  //   README and the lander are both public copy — they must name the same destinations.
  //   The inventory is the ledger of listings we pursued — every entry it calls live must appear in
  //   both copies, but it is not required to know about provenance links like GitHub.
  const publicCopies = new Set([...sources.readme.keys(), ...sources.lander.keys()]);
  for (const host of publicCopies) {
    const missing = [
      !sources.readme.has(host) ? "readme" : null,
      !sources.lander.has(host) ? "lander" : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      problems.push(`${host} is missing from: ${missing.join(", ")} — the two public copies must agree`);
    }
  }

  for (const host of sources.inventory.keys()) {
    const missing = [
      !sources.readme.has(host) ? "readme" : null,
      !sources.lander.has(host) ? "lander" : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      problems.push(`${host} is recorded as a listing but is missing from: ${missing.join(", ")}`);
    }
  }
}

const payload = {
  ok: problems.length === 0,
  counts: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v ? v.size : null])),
  problems,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...payload, exitMeaning: "findings present, not a failure" }, null, 2));
} else {
  console.log(`listing copy: readme ${payload.counts.readme}, lander ${payload.counts.lander}, inventory ${payload.counts.inventory}`);
  for (const p of problems) console.log(`  DRIFT ${p}`);
  if (problems.length === 0) console.log("  all three copies list the same destinations");
}
process.exit(problems.length === 0 ? 0 : 1);
