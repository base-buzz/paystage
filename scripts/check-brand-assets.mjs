#!/usr/bin/env node
/**
 * The brand kit must be *the* kit, not a folder of pictures nobody checked (#457).
 *
 * Six things are asserted, in the order they have actually gone wrong:
 *
 *   1. **every expected asset exists, is not zero bytes and is the documented size** — a live pass PNG answered 307
 *      with a zero-byte body while every page around it looked fine;
 *   2. **ratio**: the mark's canvas is 1.71 ± 0.02, and every ticket export follows it;
 *   3. **scallops and notches**: exactly **4** concave corner cuts and **2** mid-height notches, counted from the
 *      generated source — not by eye, and not by trusting a comment;
 *   4. **print**: the path set is Lucide `fingerprint-pattern` (9 paths), stroke 2 on a 24-grid, at 58% of H;
 *   5. **no amber anywhere in the mark**, in source or in the rendered pixels — gold belongs to the site and the pass
 *      face, never to the logo;
 *   6. **tier assets exist** at 142/89/64 wide plus the 29/58/87 tiles, and the tier boundary is the source's.
 *   7. **the downloaded pack agrees with `brand.json`**: the zip is built through the same module the page renders
 *      from, its `brand.json` is compared with the repository's (name and all), and `VERSION`/`README.txt` carry the
 *      spec date.
 *   8. **the embedded tier PNGs are the ones `brand/` just rendered** — a stale Worker copy is red here, not in
 *      production.
 *   9. **our own demo copy never says "pay with" beside the mark** — the one rule a fork breaks by accident.
 *
 * Plus the freshness ledger: every generated file is hashed in `brand/asset-manifest.json` against the masters, so a
 * half-run regeneration is not shippable.
 *
 * Exit 0 clean · 1 something is wrong (each problem is named) · 2 the kit cannot be read at all.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MARK, MARK_COLOURS, MARK_PALETTE, tierForWidth } from "./lib/mark.mjs";
import {
  PACK_PNG_NAMES,
  PACK_SVG_NAMES,
  PACK_VERSION_DATE,
  buildBrandPack,
  readStoreZip,
} from "./lib/brand-pack.mjs";
import {
  BRAND_PNG_SHA256,
  BRAND_PNGS as EMBEDDED_BRAND_PNGS,
} from "../apps/vouchguard/src/lib/brand-pngs.generated.mjs";
import { freshnessProblems } from "./lib/brand-manifest.mjs";

const BRAND = "brand";
const PASS = "apps/console/public/pass";
const MOCKS = "apps/console/public/mocks";
const DEMO_PASS = "apps/vouchguard/public/demo/vouch-demo.pkpass";

const TICKET_RATIO = 1.71;
const RATIO_TOLERANCE = 0.02;

/** Brand assets that must exist at their documented size. Ticket heights follow the master ratio. */
const ticketH = (w) => Math.round((w * MARK.height) / MARK.width);
const BRAND_PNGS = [
  ["mark-full-240.png", 240, ticketH(240)],
  ["mark-full-142.png", 142, ticketH(142)],
  ["mark-reduced-89.png", 89, ticketH(89)],
  ["mark-reduced-64.png", 64, ticketH(64)],
  ["mark-full-240-revoked.png", 240, ticketH(240)],
  ["mark-full-240-expired.png", 240, ticketH(240)],
  ["mark-icon-87.png", 87, 87],
  ["mark-icon-58.png", 58, 58],
  ["mark-icon-29.png", 29, 29],
  ["favicon-16.png", 16, 16],
  ["favicon-32.png", 32, 32],
  ["favicon-48.png", 48, 48],
  ["favicon-180.png", 180, 180],
  ["favicon-512.png", 512, 512],
  ["og-1200x630.png", 1200, 630],
  ["lockup-vertical.png", null, null],
  ["lockup-horizontal.png", null, null],
  ["lockup-mono.png", null, null],
  ["sheet-ticket.png", null, null],
];
const BRAND_SVGS = [
  "mark-full.svg",
  "mark-full-revoked.svg",
  "mark-full-expired.svg",
  "mark-full-mono.svg",
  "mark-reduced.svg",
  "mark-icon.svg",
  "wordmark-solid.svg",
  "wordmark-split.svg",
  "wordmark-plain.svg",
  "lockup-vertical.svg",
  "lockup-horizontal.svg",
  "lockup-mono.svg",
];

/** Apple's pass sizes. The same list `render-pass-assets.mjs` writes. */
const PASS_ASSETS = [
  ["pass-face@2x.png", 750, 1035],
  ["strip.png", 375, 123],
  ["strip@2x.png", 750, 246],
  ["logo.png", 160, 50],
  ["icon.png", 29, 29],
  ["icon@2x.png", 58, 58],
  ["icon@3x.png", 87, 87],
];
const PASS_SVGS = ["pass-face.svg", "mark-active.svg", "mark-revoked.svg", "mark-expired.svg"];

/** Frames that bake in the face or the mark; each can go stale alone. */
const FRAME_PATTERN = /^(frame-(pass|stack|mandate|face|setup)|story[0-9]-).*\.png$/;

const problems = [];

if (!existsSync(BRAND)) {
  console.error("brand-assets: no brand/ directory — run `npm run brand:rebuild`");
  process.exit(2);
}

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("brand-assets: sharp is not installed — run `npm install`");
  process.exit(2);
}

function fail(path, why) {
  problems.push(`${path}: ${why}`);
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
const num = (tag, name) => Number(attr(tag, name));

function requireSvg(path) {
  if (!existsSync(path)) {
    fail(path, "is missing");
    return "";
  }
  if (statSync(path).size === 0) {
    fail(path, "is 0 bytes");
    return "";
  }
  return readFileSync(path, "utf8");
}

async function pngSize(path, expectedWidth = null, expectedHeight = null) {
  if (!existsSync(path)) {
    fail(path, "is missing — run `npm run brand:rebuild`");
    return null;
  }
  if (statSync(path).size === 0) {
    fail(path, "is 0 bytes");
    return null;
  }
  const meta = await sharp(path).metadata();
  if (expectedWidth !== null && (meta.width !== expectedWidth || meta.height !== expectedHeight)) {
    fail(path, `is ${meta.width}x${meta.height}, expected ${expectedWidth}x${expectedHeight}`);
  }
  return meta;
}

/* 1 · expected files, sizes, no empty bytes */
for (const [name, width, height] of BRAND_PNGS) await pngSize(join(BRAND, name), width, height);
for (const name of BRAND_SVGS) requireSvg(join(BRAND, name));

for (const [name, width, height] of PASS_ASSETS) await pngSize(join(PASS, name), width, height);
for (const name of PASS_SVGS) requireSvg(join(PASS, name));

if (existsSync(MOCKS)) {
  for (const file of readdirSync(MOCKS)) {
    if (FRAME_PATTERN.test(file)) await pngSize(join(MOCKS, file));
  }
  if (!readdirSync(MOCKS).some((file) => FRAME_PATTERN.test(file))) {
    fail(MOCKS, "contains no storyboard frames");
  }
} else {
  fail(MOCKS, "is missing — the storyboard would ship broken images");
}

if (existsSync(DEMO_PASS)) {
  if (statSync(DEMO_PASS).size === 0) fail(DEMO_PASS, "is 0 bytes — the demo pass is a signed snapshot, not a placeholder");
} else {
  fail(DEMO_PASS, "is missing — the demo pass cannot be downloaded");
}

/* 2 · ratio, from the numbers and from every ticket export */
{
  const ratio = MARK.width / MARK.height;
  if (Math.abs(ratio - TICKET_RATIO) > RATIO_TOLERANCE) {
    fail("scripts/lib/mark.mjs", `the master is ${ratio.toFixed(3)}:1, spec is ${TICKET_RATIO} ±${RATIO_TOLERANCE}`);
  }
  for (const [name] of BRAND_PNGS.filter(([name]) => name.startsWith("mark-full-") || name.startsWith("mark-reduced-"))) {
    const path = join(BRAND, name);
    if (!existsSync(path) || statSync(path).size === 0) continue;
    const meta = await sharp(path).metadata();
    const actual = meta.width / meta.height;
    if (Math.abs(actual - TICKET_RATIO) > RATIO_TOLERANCE) {
      fail(path, `is ${actual.toFixed(3)}:1, spec is ${TICKET_RATIO} ±${RATIO_TOLERANCE}`);
    }
  }
  for (const name of BRAND_SVGS.filter((name) => name.startsWith("mark-") && !name.startsWith("mark-icon"))) {
    const svg = requireSvg(join(BRAND, name));
    if (!svg) continue;
    const width = Number(svg.match(/<svg[^>]*\bwidth="([\d.]+)"/)?.[1]);
    const height = Number(svg.match(/<svg[^>]*\bheight="([\d.]+)"/)?.[1]);
    if (width && height && Math.abs(width / height - TICKET_RATIO) > RATIO_TOLERANCE) {
      fail(join(BRAND, name), `is ${(width / height).toFixed(3)}:1, spec is ${TICKET_RATIO} ±${RATIO_TOLERANCE}`);
    }
  }
}

/* 3 · exactly four scallops and two mid notches, counted from the source */
function checkCuts(path) {
  const svg = requireSvg(path);
  if (!svg) return;
  const circles = [...svg.matchAll(/<circle\b[^>]*>/g)].map((m) => m[0]);
  const scallops = circles.filter((tag) => attr(tag, "data-scallop") !== null);
  const notches = circles.filter((tag) => attr(tag, "data-notch") !== null);

  if (scallops.length !== MARK.scallop.count) {
    fail(path, `has ${scallops.length} corner scallop(s), the spec is ${MARK.scallop.count}`);
  }
  if (notches.length !== MARK.notch.count) {
    fail(path, `has ${notches.length} mid notch(es), the spec is ${MARK.notch.count}`);
  }

  const expectedCorners = new Set([
    `${MARK.inset},${MARK.inset}`,
    `${MARK.width - MARK.inset},${MARK.inset}`,
    `${MARK.inset},${MARK.height - MARK.inset}`,
    `${MARK.width - MARK.inset},${MARK.height - MARK.inset}`,
  ]);
  for (const tag of scallops) {
    const r = num(tag, "r");
    if (Math.abs(r - MARK.scallop.radius) > 0.05) {
      fail(path, `a scallop has r=${r}, spec ${MARK.scallop.radius.toFixed(2)} (0.085 H)`);
    }
    expectedCorners.delete(`${num(tag, "cx")},${num(tag, "cy")}`);
  }
  if (expectedCorners.size > 0) {
    fail(path, `scallops are not on all four body corners (missing ${[...expectedCorners].join("; ")})`);
  }
  const notchSides = new Set(
    notches.map((tag) => `${num(tag, "cx") === 0 ? "left" : num(tag, "cx") === MARK.width ? "right" : "middle"}`),
  );
  if (!notchSides.has("left") || !notchSides.has("right") || notchSides.size !== 2) {
    fail(path, `mid notches are not one per end (found ${[...notchSides].join(", ")})`);
  }
  for (const tag of notches) {
    if (Math.abs(num(tag, "r") - MARK.notch.radius) > 0.05) {
      fail(path, `a mid notch has r=${num(tag, "r")}, spec ${MARK.notch.radius.toFixed(2)} (0.105 H)`);
    }
    if (Math.abs(num(tag, "cy") - MARK.height / 2) > 0.01) {
      fail(path, `a mid notch is at y=${num(tag, "cy")}, spec H/2=${MARK.height / 2}`);
    }
  }
  // The cuts must actually cut: the body rect has to reference the mask that holds them.
  const body = svg.match(/<rect\b[^>]*data-body="1"[^>]*>/)?.[0] ?? "";
  if (!body) fail(path, "has no body rect");
  else if (!/mask="url\(#/.test(body)) fail(path, "the body does not reference the mask, so the scallops are decorative");
  if (MARK.notch.radius <= MARK.scallop.radius) {
    fail("scripts/lib/mark.mjs", "the mid notch is not larger than the corner scallop — the tear stops winning at size");
  }
}

for (const name of ["mark-full.svg", "mark-full-revoked.svg", "mark-full-expired.svg", "mark-full-mono.svg", "mark-reduced.svg"]) {
  checkCuts(join(BRAND, name));
}

/* 4 · the print is the nine-path Lucide set at stroke 2 on a 24-grid */
function checkPrint(path, expectedStrokeScale) {
  const svg = requireSvg(path);
  if (!svg) return;
  const group = svg.match(/<g\b[^>]*data-print-set="[^"]*"[^>]*>/)?.[0] ?? "";
  if (!group) {
    fail(path, "has no print group");
    return;
  }
  if (attr(group, "data-print-set") !== MARK.print.set) {
    fail(path, `print set is ${attr(group, "data-print-set")}, spec ${MARK.print.set}`);
  }
  if (Number(attr(group, "data-print-grid")) !== MARK.print.grid) {
    fail(path, `print grid is ${attr(group, "data-print-grid")}, spec ${MARK.print.grid}`);
  }
  if (Number(attr(group, "data-print-stroke")) !== MARK.print.stroke) {
    fail(path, `print stroke is ${attr(group, "data-print-stroke")}, spec ${MARK.print.stroke}`);
  }
  const strokeScale = Number(attr(group, "data-print-stroke-scale"));
  if (Number.isFinite(expectedStrokeScale) && Math.abs(strokeScale - expectedStrokeScale) > 0.001) {
    fail(path, `print stroke scale is ${strokeScale}, expected ${expectedStrokeScale}`);
  }
  const scale = Number(attr(group, "data-print-scale"));
  const heightShare = (MARK.print.grid * scale) / MARK.height;
  if (Math.abs(heightShare - MARK.print.heightShare) > 0.005) {
    fail(path, `print height is ${(heightShare * 100).toFixed(1)}% of H, spec ${(MARK.print.heightShare * 100).toFixed(0)}%`);
  }
  const paths = [...svg.matchAll(/<path\b[^>]*data-print="1"[^>]*>/g)].map((m) => attr(m[0], "d"));
  if (paths.length !== MARK.print.paths.length) {
    fail(path, `has ${paths.length} print path(s), Lucide has ${MARK.print.paths.length}`);
  } else if (paths.some((d, i) => d !== MARK.print.paths[i])) {
    fail(path, `the print paths are not the canonical Lucide fingerprint-pattern set`);
  }
}

checkPrint(join(BRAND, "mark-full.svg"), 1);
checkPrint(join(BRAND, "mark-full-revoked.svg"), 1);
checkPrint(join(BRAND, "mark-full-expired.svg"), 1);
checkPrint(join(BRAND, "mark-full-mono.svg"), 1);
checkPrint(join(BRAND, "mark-reduced.svg"), MARK.tiers.reduced.strokeScale);

{
  const svg = requireSvg(join(BRAND, "mark-icon.svg"));
  if (svg) {
    const group = svg.match(/<g\b[^>]*data-print-set="[^"]*"[^>]*>/)?.[0] ?? "";
    const paths = [...svg.matchAll(/<path\b[^>]*data-print="1"[^>]*>/g)].map((m) => attr(m[0], "d"));
    if (paths.length !== MARK.print.paths.length || paths.some((d, i) => d !== MARK.print.paths[i])) {
      fail(join(BRAND, "mark-icon.svg"), "does not carry the canonical nine-path Lucide print");
    }
    if (Number(attr(group, "data-print-grid")) !== MARK.print.grid || Number(attr(group, "data-print-stroke")) !== MARK.print.stroke) {
      fail(join(BRAND, "mark-icon.svg"), "print is not on the 24-grid at stroke 2");
    }
    const size = Number(attr(svg.match(/<svg\b[^>]*>/)?.[0] ?? "", "width"));
    const scale = Number(attr(group, "data-print-scale"));
    if (size && Math.abs((MARK.print.grid * scale) / size - MARK.tiers.icon.printShare) > 0.01) {
      fail(join(BRAND, "mark-icon.svg"), `print is not ${(MARK.tiers.icon.printShare * 100).toFixed(0)}% of the tile side`);
    }
    const tile = svg.match(/<rect\b[^>]*data-tile="1"[^>]*>/)?.[0] ?? "";
    if (!tile) fail(join(BRAND, "mark-icon.svg"), "has no tile");
    else if (size && Math.abs(num(tile, "rx") / size - MARK.tiers.icon.radiusShare) > 0.01) {
      fail(join(BRAND, "mark-icon.svg"), `tile radius is not ${(MARK.tiers.icon.radiusShare * 100).toFixed(0)}% of the side`);
    }
  }
}

/* 5 · no amber in the mark — source colours and rendered pixels */
const AMBER_NAMES = new Set(["F7B600", "D4A843", "FFBF00", "FFC107", "E0A100", "F5A623", "FFB000"]);
function isAmberHex(hex) {
  const raw = hex.replace("#", "").toUpperCase();
  if (AMBER_NAMES.has(raw)) return true;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.08 || max < 0.25) return false;
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  const sat = delta / max;
  return hue >= 30 && hue <= 65 && sat >= 0.35;
}
{
  const allowed = new Set([...MARK_PALETTE.map((c) => c.toUpperCase()), "#FFFFFF", "#000000"]);
  for (const name of BRAND_SVGS.filter((name) => name.startsWith("mark-"))) {
    const svg = requireSvg(join(BRAND, name));
    if (!svg) continue;
    for (const hex of svg.match(/#[0-9a-fA-F]{6}/g) ?? []) {
      if (isAmberHex(hex)) fail(join(BRAND, name), `contains amber ${hex} — gold belongs to the site and the pass face, not the logo`);
      if (!allowed.has(hex.toUpperCase())) fail(join(BRAND, name), `contains ${hex}, which is not in the mark palette`);
    }
  }
  // Rendered pixels, so a gradient or an opacity cannot smuggle amber past the source scan.
  for (const name of ["mark-full-240.png", "mark-icon-87.png"]) {
    const path = join(BRAND, name);
    if (!existsSync(path) || statSync(path).size === 0) continue;
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let amber = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a > 128 && r > 150 && g > 90 && b < 80) amber++;
    }
    if (amber > 0) fail(path, `has ${amber} amber pixel(s) — the mark must not contain amber`);
  }
}

/* 6 · tier assets at 142/89/64 plus the tiles, and the boundary is the source's */
{
  const expected = [
    [142, "full"],
    [141, "reduced"],
    [89, "reduced"],
    [64, "reduced"],
    [63, "icon"],
  ];
  for (const [width, tier] of expected) {
    if (tierForWidth(width) !== tier) fail("scripts/lib/mark.mjs", `tierForWidth(${width}) is ${tierForWidth(width)}, expected ${tier}`);
  }
  for (const [name, width] of [
    ["mark-full-142.png", 142],
    ["mark-reduced-89.png", 89],
    ["mark-reduced-64.png", 64],
    ["mark-icon-87.png", 87],
    ["mark-icon-58.png", 58],
    ["mark-icon-29.png", 29],
  ]) {
    const path = join(BRAND, name);
    if (!existsSync(path) || statSync(path).size === 0) continue;
    const meta = await sharp(path).metadata();
    if (meta.width !== width) fail(path, `is ${meta.width} px wide, tier asset must be ${width}`);
    if (name.startsWith("mark-icon") && meta.width !== meta.height) fail(path, `is ${meta.width}x${meta.height}, icon tiles are square`);
  }
  const reduced = readFileSync(join(BRAND, "mark-reduced.svg"), "utf8");
  if (!/data-print-stroke-scale="1\.35"/.test(reduced)) {
    fail(join(BRAND, "mark-reduced.svg"), "does not thicken the print stroke — the reduced tier would blur at 64 px");
  }
}

/* 7 · the pass poster marks are the same ticket, with the state in the print */
for (const [file, state] of [
  ["mark-active.svg", "#101322"],
  ["mark-revoked.svg", MARK_COLOURS.print.revoked],
  ["mark-expired.svg", MARK_COLOURS.print.expired],
]) {
  const path = join(PASS, file);
  if (!existsSync(path)) continue;
  const svg = readFileSync(path, "utf8");
  if (!/data-body="1"/.test(svg)) fail(path, "has no ticket body — this is not the mark");
  if (!/data-print-set="lucide\/fingerprint-pattern"/.test(svg)) fail(path, "does not carry the Lucide print");
  if (!svg.includes(`stroke="${state}"`)) fail(path, `the print is not ${state} — that is the state colour`);
  const circles = [...svg.matchAll(/<circle\b[^>]*>/g)].filter((m) => attr(m[0], "data-scallop") !== null).length;
  if (circles !== MARK.scallop.count) fail(path, `has ${circles} scallop(s), expected ${MARK.scallop.count}`);
}

/* 8 · freshness: every generated asset matches the ledger, and the masters have not moved under it */
for (const problem of freshnessProblems()) problems.push(problem);

/* 9 · the downloadable pack and the repository's brand.json cannot disagree */
{
  const BRAND_FILE = "brand.json";
  const PACK_ROUTE = "apps/vouchguard/src/app/brand/vg-brand-pack.zip/route.ts";
  if (!existsSync(PACK_ROUTE)) {
    fail(PACK_ROUTE, "is missing — the download would 404");
  } else {
    const route = readFileSync(PACK_ROUTE, "utf8");
    if (!/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/brand\.json"/.test(route)) {
      fail(PACK_ROUTE, "does not import the repository's brand.json");
    }
    if (!/buildBrandPack\(\{\s*brand:\s*brandJson/.test(route)) {
      fail(PACK_ROUTE, "does not pass the repository's brand.json to buildBrandPack");
    }
    if (!/BRAND_PNGS/.test(route)) {
      fail(PACK_ROUTE, "does not use the generated PNG exports");
    }
  }
  if (!existsSync(BRAND_FILE)) {
    fail(BRAND_FILE, "is missing — the pack has nothing to name it");
  } else {
    let brandJson;
    try {
      brandJson = JSON.parse(readFileSync(BRAND_FILE, "utf8"));
    } catch (error) {
      fail(BRAND_FILE, `is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    if (brandJson) {
      const pngs = {};
      for (const name of PACK_PNG_NAMES) {
        const path = join(BRAND, name);
        if (!existsSync(path)) fail("brand-pack", `${name} is missing — the pack would be incomplete`);
        else pngs[name] = readFileSync(path);
      }
      if (Object.keys(pngs).length === PACK_PNG_NAMES.length) {
        try {
          const entries = readStoreZip(buildBrandPack({ brand: brandJson, pngs }));
          const decode = (name) => (entries.has(name) ? new TextDecoder().decode(entries.get(name)) : null);
          const expected = [
            "README.txt",
            "VERSION",
            "LICENCE",
            "LICENCE-LUCIDE",
            "brand.json",
            ...PACK_SVG_NAMES.map((name) => `svg/${name}`),
            ...PACK_PNG_NAMES.map((name) => `png/${name}`),
          ];
          for (const name of expected) {
            if (!entries.has(name)) fail("brand-pack", `the zip has no ${name}`);
          }
          const zippedBrand = decode("brand.json");
          if (zippedBrand === null) {
            fail("brand-pack", "the zip has no brand.json");
          } else {
            let parsed;
            try {
              parsed = JSON.parse(zippedBrand);
            } catch {
              fail("brand-pack", "the zip's brand.json is not JSON");
            }
            if (parsed) {
              if (parsed.name !== brandJson.name) {
                fail(
                  "brand-pack",
                  `the zip's brand.json names ${JSON.stringify(parsed.name)}, the repo's names ${JSON.stringify(brandJson.name)}`,
                );
              }
              if (JSON.stringify(parsed) !== JSON.stringify(brandJson)) {
                fail("brand-pack", "the zip's brand.json does not match the repository's brand.json");
              }
            }
          }
          const version = decode("VERSION")?.trim();
          if (version !== PACK_VERSION_DATE) {
            fail("brand-pack", `VERSION is ${JSON.stringify(version)}, expected ${JSON.stringify(PACK_VERSION_DATE)}`);
          }
          const readme = decode("README.txt") ?? "";
          if (!readme.includes(`Version — ${PACK_VERSION_DATE}`)) {
            fail("brand-pack", `README.txt does not repeat "Version — ${PACK_VERSION_DATE}"`);
          }
          for (const name of PACK_SVG_NAMES) {
            const svg = decode(`svg/${name}`) ?? "";
            if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) {
              fail("brand-pack", `svg/${name} is not a complete SVG`);
            }
          }
          for (const name of PACK_PNG_NAMES) {
            const data = entries.get(`png/${name}`);
            if (!data || data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
              fail("brand-pack", `png/${name} is not a PNG`);
            }
          }
        } catch (error) {
          fail("brand-pack", `the pack cannot be built or read (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    }
  }
}

/* 10 · the embedded tier PNGs are the bytes brand/ just rendered; a stale Worker copy is a red check */
{
  const GENERATED = "apps/vouchguard/src/lib/brand-pngs.generated.mjs";
  for (const name of PACK_PNG_NAMES) {
    const path = join(BRAND, name);
    if (!existsSync(path)) continue;
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (BRAND_PNG_SHA256[name] !== actual) {
      fail(GENERATED, `${name} is stale — run \`node scripts/gen-brand-png-module.mjs\``);
      continue;
    }
    const decoded = Buffer.from(EMBEDDED_BRAND_PNGS[name] ?? "", "base64");
    const embedded = createHash("sha256").update(decoded).digest("hex");
    if (embedded !== actual) {
      fail(GENERATED, `${name} decodes to different bytes than brand/${name}`);
    }
  }
}

/* 11 · our own demo copy must never say "pay with" beside the mark — the one rule a fork breaks by accident */
{
  const SRC = "apps/vouchguard/src";
  const NEGATED = /\b(?:never|not|no|without|cannot|can't|don't|do not|must not|must never)\b/i;
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(path);
    }
  };
  if (existsSync(SRC)) walk(SRC);
  for (const file of files) {
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const sentence of text.split(/(?<=[.!?])\s+|\n{2,}/)) {
      const match = sentence.match(/\bpay[\s-]?with\b/i);
      if (!match) continue;
      if (NEGATED.test(sentence)) continue;
      const index = text.indexOf(match[0]);
      const line = text.slice(0, index).split("\n").length;
      fail(file, `line ${line}: affirmative "pay with" beside the mark — the mark is not a payment method; say never, or drop it`);
    }
  }
}

if (problems.length > 0) {
  console.error(`brand-assets: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("  run `npm run brand:rebuild`; if a problem survives that, the renderer and the spec disagree.");
  process.exit(1);
}

const frameCount = existsSync(MOCKS) ? readdirSync(MOCKS).filter((f) => FRAME_PATTERN.test(f)).length : 0;
const assetCount =
  BRAND_PNGS.length + BRAND_SVGS.length + PASS_ASSETS.length + PASS_SVGS.length + frameCount + 1;
console.log(
  `brand-assets: ${assetCount} asset(s) present, no empty files · ratio ${(MARK.width / MARK.height).toFixed(3)}:1 ` +
    `(${TICKET_RATIO}±${RATIO_TOLERANCE}) · ${MARK.scallop.count} scallops + ${MARK.notch.count} mid notches ` +
    `(r ${MARK.scallop.radius.toFixed(2)}/${MARK.notch.radius.toFixed(2)}) · print ${MARK.print.paths.length} Lucide paths, ` +
    `stroke ${MARK.print.stroke}/${MARK.print.grid} at ${(MARK.print.heightShare * 100).toFixed(0)}% H · no amber · tiers 142/89/64 + 29/58/87 · ledger fresh`,
);
