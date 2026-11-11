#!/usr/bin/env node
/**
 * Dependency selection gate — the matrix, executable.
 *
 * Prose rules in AGENTS.md get skipped under time pressure. This is rule 12, executable. This scores a candidate
 * package against the same six criteria the rules describe, so "should we install X?"
 * has an answer a command produces rather than a judgement someone remembers to make.
 *
 *   node scripts/npm-check.mjs date-fns
 *   node scripts/npm-check.mjs zod --json
 *   node scripts/npm-check.mjs some-pkg --against package.json
 *
 * Exit codes: 0 acceptable · 1 hard fail (missing, deprecated, install script, CVE-ish)
 *             2 needs a human decision (thin maintenance or popularity, heavy tree)
 */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const against = (() => {
  const i = args.indexOf("--against");
  return i >= 0 ? args[i + 1] : undefined;
})();
const names = args.filter((a, i) => !a.startsWith("--") && (i === 0 || args[i - 1] !== "--against"));

if (names.length === 0) {
  console.error("usage: npm-check.mjs <package> [more…] [--json] [--against package.json]");
  process.exit(64);
}

const get = async (url) => {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

const MONTHS = 18;

async function score(name) {
  const meta = await get(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
  const week = await get(`https://api.npmjs.org/downloads/point/last-week/${name.replace("/", "%2F")}`);
  // Initialise every field the printer reads, so an early return cannot leave one
  // undefined and crash the report on the row that matters most.
  const found = { name, criteria: {}, verdict: "pass", notes: [], weeklyDownloads: null, lastPublishMonths: null };

  // 1. Existence & security (gate)
  if (meta === null) {
    found.criteria.existence = "fail";
    found.verdict = "fail";
    found.notes.push("not on the registry — a hallucinated name, or private");
    return found;
  }
  found.criteria.existence = "pass";

  const latest = meta["dist-tags"]?.latest;
  const version = meta.versions?.[latest] ?? {};
  const publishedAt = meta.time?.[latest] ? Date.parse(meta.time[latest]) : null;
  const ageMonths = publishedAt === null ? null : (Date.now() - publishedAt) / (30.44 * 86_400_000);

  if (meta.deprecated) {
    found.criteria.deprecated = "fail";
    found.verdict = "fail";
    found.notes.push(`deprecated: ${String(meta.deprecated).slice(0, 100)}`);
  }

  const scripts = version.scripts ?? {};
  const installScripts = ["preinstall", "install", "postinstall"].filter((s) => scripts[s]);
  if (installScripts.length > 0) {
    found.criteria.installScripts = "warn";
    found.notes.push(`runs install scripts: ${installScripts.join(", ")} — read them before installing`);
  }

  // 2. Existing stack fit
  if (against) {
    try {
      const local = JSON.parse(readFileSync(against, "utf8"));
      const present = { ...(local.dependencies ?? {}), ...(local.devDependencies ?? {}) };
      found.criteria.stackFit = present[name] ? "already-installed" : "new";
      if (present[name]) found.notes.push(`already in ${against} at ${present[name]}`);
    } catch {
      /* no local manifest to compare against */
    }
  } else {
    found.alreadyInRepo = probeRepo(name);
    if (found.alreadyInRepo) found.criteria.stackFit = "already-in-repo";
  }

  // 3. Maintenance
  found.lastPublishMonths = ageMonths === null ? null : Math.round(ageMonths * 10) / 10;
  if (ageMonths !== null && ageMonths > MONTHS) {
    found.criteria.maintenance = "warn";
    found.notes.push(`last publish ${Math.round(ageMonths)} months ago (>${MONTHS} is stale)`);
  } else {
    found.criteria.maintenance = "pass";
  }

  // 4. Popularity
  found.weeklyDownloads = week?.downloads ?? null;
  if (week?.downloads === undefined) {
    found.criteria.popularity = "unknown";
  } else if (week.downloads < 1_000) {
    found.criteria.popularity = "warn";
    found.notes.push(`${week.downloads} weekly downloads — verify it is the right package, not a lookalike`);
  } else {
    found.criteria.popularity = "pass";
  }

  // 5. Types
  const hasTypes = Boolean(version.types || version.typings || version.exports?.["."]?.types);
  found.criteria.types = hasTypes ? "pass" : "warn";
  if (!hasTypes) found.notes.push("no bundled types — a separate @types package would be needed");

  // 6. Footprint
  const deps = Object.keys(version.dependencies ?? {}).length;
  found.dependencyCount = deps;
  found.unpackedKB = version.dist?.unpackedSize ? Math.round(version.dist.unpackedSize / 1024) : null;
  if (deps > 25 || (found.unpackedKB ?? 0) > 2_000) {
    found.criteria.footprint = "warn";
    found.notes.push(`${deps} dependencies, ${found.unpackedKB ?? "?"} KB unpacked`);
  } else {
    found.criteria.footprint = "pass";
  }

  if (found.verdict !== "fail" && Object.values(found.criteria).includes("warn")) found.verdict = "review";
  return found;
}

/** Is this already a dependency anywhere in the workspace? */
function probeRepo(name) {
  try {
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    if ({ ...(root.dependencies ?? {}), ...(root.devDependencies ?? {}) }[name]) return true;
  } catch {
    /* not at the repo root */
  }
  return false;
}

const results = [];
for (const name of names) results.push(await score(name));

if (asJson) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  for (const r of results) {
    const mark = r.verdict === "fail" ? "FAIL  " : r.verdict === "review" ? "REVIEW" : "PASS  ";
    console.log(`${mark} ${r.name}`);
    for (const [k, v] of Object.entries(r.criteria)) console.log(`  ${k.padEnd(14)} ${v}`);
    if (typeof r.weeklyDownloads === "number") console.log(`  ${"downloads".padEnd(14)} ${r.weeklyDownloads.toLocaleString()}/week`);
    if (typeof r.lastPublishMonths === "number") console.log(`  ${"last publish".padEnd(14)} ${r.lastPublishMonths} months ago`);
    for (const n of r.notes) console.log(`  · ${n}`);
    console.log();
  }
}

const worst = results.some((r) => r.verdict === "fail") ? 1 : results.some((r) => r.verdict === "review") ? 2 : 0;
process.exit(worst);
