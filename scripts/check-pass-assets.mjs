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
 * The poster mark the `/m/:serial` page renders. The mark is the **ticket** — a teal body with four corner scallops,
 * two mid notches and the Lucide print — and the page paints it with a paper body over the mandate's tint, so the
 * **print** is the state colour (ink active, red revoked, the spec's grey expired). Three properties matter here and
 * none is cosmetic: the body must be present, the print must be the nine-path set, and the state must live in the print's
 * stroke rather than the silhouette (the settled 2026-11-27 spec; the old "revoked tears the stub" rule is gone).
 */
const posterMarks = ["mark-active.svg", "mark-revoked.svg", "mark-expired.svg"];
const posterBody = new Map();
for (const file of posterMarks) {
  if (!present.has(file)) {
    problems.push(`${file} is missing — the /m page would draw a different mark from the pass`);
    continue;
  }
  const text = readFileSync(join(DIR, file), "utf8");
  if (!text.includes('data-body="1"')) problems.push(`${file} has no ticket body — this is not the mark`);
  if (!text.includes('data-print-set="lucide/fingerprint-pattern"')) {
    problems.push(`${file} does not carry the Lucide fingerprint-pattern print`);
  }
  const paths = [...text.matchAll(/<path\b[^>]*data-print="1"/g)].length;
  if (paths !== 9) problems.push(`${file} has ${paths} print paths, Lucide has 9`);
  const body = text.match(/data-body="1"[^>]*fill="([^"]+)"/)?.[1] ?? text.match(/fill="([^"]+)"[^>]*data-body="1"/)?.[1];
  if (body) posterBody.set(file, body.toLowerCase());
  const print = text.match(/<g\b[^>]*data-print-set="[^"]*"[^>]*stroke="([^"]+)"/)?.[1];
  const expected = file.includes("revoked") ? "#b42318" : file.includes("expired") ? "#8a8f98" : "#101322";
  if (print && print.toLowerCase() !== expected) {
    problems.push(`${file} prints in ${print}, expected ${expected} — the state lives in the print`);
  }
}
if (new Set(posterBody.values()).size > 1) {
  problems.push("the three poster marks do not share one body colour — the ticket must not become the state");
}

if (problems.length > 0) {
  console.error(`pass-assets: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("  fix: node scripts/render-pass-assets.mjs");
  process.exit(1);
}

console.log(`pass-assets: ${EXPECTED.length} asset(s) at Apple's sizes, plus the source SVG, in ${DIR}`);
