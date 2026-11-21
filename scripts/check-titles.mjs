#!/usr/bin/env node
/**
 * A page title must not carry the site suffix twice.
 *
 *   node scripts/check-titles.mjs
 *
 * Exit 0 every page title is composed once · 1 a title hardcodes the suffix the layout adds · 2 cannot read.
 *
 * `apps/console/src/app/layout.tsx` sets `title.template = "%s — PayStage"`. Five pages also wrote the suffix into
 * their own metadata, so the browser tab read `Privacy — PayStage — PayStage` on the live site for as long as those
 * pages existed — found on 2026-11-20 while adding a sixth page that copied the pattern. Nothing failed, because a
 * doubled suffix is still a string.
 *
 * The rule, checkable here: inside `apps/console`, a `metadata` title is either a bare name (`"Privacy"`, the
 * template supplies the rest) or a full sentence that does not end in the site name.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps/console/src/app");
const SUFFIX = "— PayStage";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === "page.tsx" || entry.name === "layout.tsx") out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(APP);
} catch (error) {
  console.error(`titles: cannot read ${APP} — ${error.code ?? error.message}`);
  process.exit(2);
}

const offenders = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  // Only the top-level metadata title, not per-section titles inside the page body.
  const match = /export const metadata[^=]*=\s*\{[\s\S]*?\btitle:\s*"([^"]+)"/.exec(source);
  if (!match) continue;
  const title = match[1];
  if (title.endsWith(SUFFIX)) offenders.push({ file: file.replace(`${ROOT}/`, ""), title });
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`titles: ${o.file} — title ends in "${SUFFIX}", which layout.tsx already appends: ${o.title}`);
  console.error(`titles: ${offenders.length} page(s) would render the site name twice`);
  process.exit(1);
}

console.log(`titles: ${files.length} page/layout file(s), no title doubles the site suffix`);
process.exit(0);
