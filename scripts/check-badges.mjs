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

const problems = [];
for (const url of badges) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
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

for (const p of problems) console.error(`  FAIL ${p}`);
console.log(problems.length === 0 ? `badges: ${badges.length} badge(s), all resolve to an image` : `badges: ${problems.length} broken`);
process.exit(problems.length === 0 ? 0 : 10);
