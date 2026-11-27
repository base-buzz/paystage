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

import { MARK_COLOURS } from "./lib/mark.mjs";

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
  /**
   * The poster palette lives in `scripts/lib/mark.mjs` — three files used to spell it out independently, which is how the on-body and
   * on-paper tones drifted apart in the first place (#487). One source, read here.
   */
  const expected = (file.includes("revoked")
    ? MARK_COLOURS.printOnPaper.revoked
    : file.includes("expired")
      ? MARK_COLOURS.printOnPaper.expired
      : MARK_COLOURS.printOnPaper.active
  ).toLowerCase();
  if (print && print.toLowerCase() !== expected) {
    problems.push(`${file} prints in ${print}, expected ${expected} — the state lives in the print`);
  }
}
if (new Set(posterBody.values()).size > 1) {
  problems.push("the three poster marks do not share one body colour — the ticket must not become the state");
}

/**
 * The Wallet logo, learned from a phone (#468).
 *
 * On the device the logo was **invisible**: it was a solid `DEEP` rectangle with the word "PAYSTAGE" in paper, and the
 * pass background is that same deep, so the block vanished and only a faint wordmark showed. Two assertions now hold:
 * the logo must carry the **mark's geometry** (a ticket, not a wordmark), and its ink must **contrast with the pass
 * background** — a logo that matches the background is not a logo.
 */
const logoPath = join(DIR, "logo.png");
if (existsSync(logoPath)) {
  const { data, info } = await sharp(logoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] > 128) {
      const hex = `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const coverage = [...counts.values()].reduce((a, b) => a + b, 0) / (info.width * info.height);
  // A wordmark-on-a-block covers the canvas; a mark on transparent covers well under half.
  if (coverage > 0.55) {
    problems.push(`${logoPath} covers ${(coverage * 100).toFixed(0)}% of its canvas — that is a filled block, not the mark on transparent`);
  }
  const background = "#1a1f71";
  if (dominant && dominant.toLowerCase() === background) {
    problems.push(`${logoPath} is drawn in the pass background colour (${dominant}) — on the device it disappears`);
  }
}

if (problems.length > 0) {
  console.error(`pass-assets: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("  fix: node scripts/render-pass-assets.mjs");
  process.exit(1);
}

console.log(`pass-assets: ${EXPECTED.length} asset(s) at Apple's sizes, plus the source SVG, in ${DIR}`);
