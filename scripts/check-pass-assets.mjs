#!/usr/bin/env node
/**
 * Are the committed pass assets the sizes Apple will accept, and are they generated from the master?
 *
 *   node scripts/check-pass-assets.mjs
 *
 * Exit 0 every asset exists at its documented size and carries a provenance comment · 1 a size is wrong or an
 * asset is missing · 2 sharp or the asset directory is unreadable.
 *
 * Why this exists rather than a note in the proposal (#434): Apple rejects a pass whose strip or icon is off by a
 * pixel and reports it as "the pass could not be added", with no field named. Sizes were transcribed from
 * `docs/proposals/vouch-pass-face.md` once; a transcription that is checked is a fact and a transcription that is
 * remembered is a typo waiting for a release.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DIR = resolve(process.argv[2] ?? "apps/console/public/pass");

/** Apple's storeCard table, as used by `render-pass-assets.mjs`. */
export const EXPECTED = [
  ["pass-face@2x.png", 750, 1035],
  ["strip.png", 375, 123],
  ["strip@2x.png", 750, 246],
  ["logo.png", 160, 50],
  ["icon.png", 29, 29],
  ["icon@2x.png", 58, 58],
  ["icon@3x.png", 87, 87],
];

if (!existsSync(DIR)) {
  console.error(`pass-assets: no asset directory at ${DIR} — run node scripts/render-pass-assets.mjs`);
  process.exit(2);
}

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("pass-assets: sharp is not installed — run `npm install`");
  process.exit(2);
}

const present = new Set(readdirSync(DIR));
const problems = [];
for (const [file, width, height] of EXPECTED) {
  if (!present.has(file)) {
    problems.push(`${file} is missing — the pass would be rejected with no field named`);
    continue;
  }
  const meta = await sharp(join(DIR, file)).metadata();
  if (meta.width !== width || meta.height !== height) {
    problems.push(`${file} is ${meta.width}x${meta.height}, Apple wants ${width}x${height}`);
  }
}
if (!present.has("pass-face.svg")) {
  problems.push("pass-face.svg is missing — the lander must inline the same source that was rasterised");
}

/**
 * The poster mark the `/m/:serial` page renders (#440). The 2026-11-27 venn is two solid plates with the state in
 * the lens; the page paints it inverted over the mandate's tint, so both plates must be present (paper) and the
 * lens must be a distinct filled element. An outlined plate or a missing lens would be the old seal or a stale
 * drawing, and the page would show a different mark from the pass.
 */
for (const file of ["mark-active.svg", "mark-revoked.svg", "mark-expired.svg"]) {
  if (!present.has(file)) {
    problems.push(`${file} is missing — the /m page would draw a different mark from the pass`);
    continue;
  }
  const text = readFileSync(join(DIR, file), "utf8");
  for (const needle of ['data-plate="A"', 'data-plate="B"', 'data-lens="1"']) {
    if (!text.includes(needle)) problems.push(`${file} has no ${needle} — the venn is not the mark in this file`);
  }
}

if (problems.length > 0) {
  console.error(`pass-assets: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("  fix: node scripts/render-pass-assets.mjs");
  process.exit(1);
}

console.log(`pass-assets: ${EXPECTED.length} asset(s) at Apple's sizes, plus the source SVG, in ${DIR}`);
