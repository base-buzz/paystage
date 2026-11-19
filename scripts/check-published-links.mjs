#!/usr/bin/env node
/**
 * Every npm link in the docs must resolve.
 *
 * A link to `npmjs.com/package/x` is a claim that x is installable there. Two packages were added to the README while waiting for a
 * Trusted Publisher entry, and their links 404'd for anyone who followed them — the claim outrunning the artefact, which is the one
 * class of mistake this project refuses to ship. `check-doc-links` passed because a 404 on npm is not a broken markdown link.
 *
 *   node scripts/check-published-links.mjs
 *
 * Exit 0 all links resolve · 10 one does not · 11 the registry could not be read.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every README and markdown file at the root or one level down — the surfaces a stranger reads. */
function markdownFiles(dir, depth = 0) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", ".next", ".open-next"].includes(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (depth < 2) out.push(...markdownFiles(path, depth + 1));
      continue;
    }
    if (entry.endsWith(".md")) out.push(path);
  }
  return out;
}

const LINK = /https:\/\/www\.npmjs\.com\/package\/(@[a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]+)/g;
const targets = new Map();
for (const file of markdownFiles(ROOT)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(LINK)) targets.set(match[1], file.replace(`${ROOT}/`, ""));
}

if (targets.size === 0) {
  console.error("published-links: no npm links found — the scan is wrong, not the docs");
  process.exit(11);
}

const problems = [];
for (const [pkg, where] of targets) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) problems.push(`${pkg} (linked from ${where}) is not on npm`);
    else if (!res.ok) problems.push(`${pkg}: registry HTTP ${res.status} — could not confirm, treating as unverified`);
  } catch (error) {
    problems.push(`${pkg}: registry unreachable (${String(error).slice(0, 50)})`);
  }
}

for (const p of problems) console.error(`  FAIL ${p}`);
console.log(
  problems.length === 0
    ? `published-links: ${targets.size} npm link(s), all resolve`
    : `published-links: ${problems.length} of ${targets.size} link(s) do not resolve`,
);
process.exit(problems.length === 0 ? 0 : 10);
