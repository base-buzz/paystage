#!/usr/bin/env node
/**
 * Badges have to be true, and the way a badge lies is by pointing at a resource that stopped existing or a number nothing regenerates.
 *
 * #318's rule: only badges whose value is produced by the thing they describe. This checks the weaker, mechanical half — every badge URL in the README answers 200 — and
 * fails loudly when shields.io returns one of its "invalid" images, which it does with a 200 and a picture rather than a status code.
 *
 *   node scripts/check-badges.mjs
 *
 * Exit 0 all badges resolve · 10 one is broken · 11 the badge scan found nothing (the parse is wrong, not the README).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const badges = [...readme.matchAll(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]);

if (badges.length === 0) {
  console.error("badges: no badge images found in the README — the parse is wrong, or the badges were removed intentionally");
  process.exit(11);
}

/**
 * A badge is a third-party image, and GitHub/Shields return 5xx often enough to matter.
 *
 * On 2026-11-27 this check failed a cold run with `HTTP 504` from the GitHub Actions badge endpoint, twice, while every other
 * check in `ci-local` passed and the change under test could not have caused it. A gate that blocks on someone else's outage
 * gets bypassed with `--no-verify`, and then it protects nothing — so a **5xx is retried once, then reported as advisory**
 * (a fact, not a defect), while a 4xx still fails: a 404 badge is a URL we broke, a 504 is theirs.
 */
const problems = [];
const advisories = [];

const fetchOnce = async (url) => fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });

for (const url of badges) {
  try {
    let res = await fetchOnce(url);
    if (res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      res = await fetchOnce(url);
    }
    if (res.status >= 500) {
      advisories.push(`${url} -> HTTP ${res.status} (upstream unavailable, retried once)`);
      continue;
    }
    if (!res.ok) {
      problems.push(`${url} -> HTTP ${res.status}`);
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) problems.push(`${url} -> ${type} instead of an image`);
  } catch (error) {
    problems.push(`${url} -> ${String(error).slice(0, 60)}`);
  }
}

for (const advisory of advisories) console.log(`  advisory ${advisory}`);

for (const p of problems) console.error(`  FAIL ${p}`);
console.log(
  problems.length === 0
    ? `badges: ${badges.length} badge(s) resolve to an image${advisories.length > 0 ? ` (${advisories.length} advisory: upstream 5xx)` : ""}`
    : `badges: ${problems.length} broken`,
);
process.exit(problems.length === 0 ? 0 : 10);
