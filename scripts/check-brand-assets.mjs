#!/usr/bin/env node
/**
 * The brand kit must be *the* kit, not a folder of pictures nobody checked (#457).
 *
 * Three things this asserts, in the order they have actually gone wrong:
 *
 *   1. **every expected asset exists and is not zero bytes** — a live `pass/pass-face@2x.png` answered 307 with a
 *      zero-byte body while every page around it looked fine, and no check noticed;
 *   2. **the mark's geometry** — two plates, 62 × 62 at x = 0 and x = 38, radius 15, the 38.7% overlap, and
 *      a lens that is present and at least 3 px wide in the 29 px icon slot. File dimensions would pass a
 *      completely different drawing;
 *   3. **the mark's contrast** — plate B against plate A, and the lens against both, sampled from the rendered
 *      240 px PNG with the WCAG relative-luminance formula. Identical fills passed the geometry assertions
 *      while the mark rendered as one blob with a gold hole (#460), so geometry alone is not the check;
 *   4. **the generated files are readable** — a zero-byte PNG is not an asset, and a stale storyboard frame is
 *      how the old mark reaches the wallet after the master changed.
 *
 * Exit 0 clean · 1 something is wrong (each problem is named) · 2 the kit cannot be read at all.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BRAND = "brand";
const PASS = "apps/console/public/pass";
const MOCKS = "apps/console/public/mocks";
const DEMO_PASS = "apps/vouchguard/public/demo/vouch-demo.pkpass";
/**
 * The mark, final: the narrow-lens construction on an H = 100 grid. Every value is a ratio of the height, so a resize
 * cannot silently change the idea, and the one ratio that *is* the idea is `lensToOverlap` — the lens overruns the
 * overlap by 1.375. A lens drawn as the boolean intersection of the plates reads as a bar or a battery; two earlier
 * attempts shipped exactly that.
 */
const SPEC = Object.freeze({
  canvasWidth: 177.9,
  height: 100,
  plateAX: 0,
  plateAWidth: 114.4,
  plateBX: 69.3,
  plateBWidth: 108.5,
  radius: 31.4,
  overlap: 45.1,
  lensWidth: 62,
  lensCentre: 92,
  lensToOverlap: 62 / 45.1,
  tolerance: 0.01,
  markFloor: 16,
  lensFloor: 3,
  plateContrastFloor: 1.6,
  lensContrastFloor: 1.6,
});

/** Brand assets that must exist at their documented size. */
const BRAND_PNGS = [
  ["mark-venn-240.png", 240, Math.round(240 / 1.779)],
  ["mark-venn-120.png", 120, Math.round(120 / 1.779)],
  ["mark-venn-60.png", 60, Math.round(60 / 1.779)],
  ["mark-venn-29.png", 29, Math.round(29 / 1.779)],
  ["mark-venn-16.png", 16, Math.round(16 / 1.779)],
  ["favicon-16.png", 16, 16],
  ["favicon-32.png", 32, 32],
  ["favicon-48.png", 48, 48],
  ["favicon-180.png", 180, 180],
  ["favicon-512.png", 512, 512],
  ["og-1200x630.png", 1200, 630],
  ["lockup-vertical.png", null, null],
  ["lockup-horizontal.png", null, null],
  ["lockup-mono.png", null, null],
  ["sheet-venn.png", null, null],
];
const BRAND_SVGS = [
  "mark-venn.svg",
  "mark-venn-revoked.svg",
  "mark-venn-expired.svg",
  "mark-venn-mono.svg",
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

/** Frames that bake in the face or the poster mark; all eight story groups, because each can go stale alone. */
const FRAME_PATTERN = /^(frame-(pass|stack|mandate|face|setup)|story[0-9]-).*\.png$/;

const problems = [];

if (!existsSync(BRAND)) {
  console.error("brand-assets: no brand/ directory — run `npm run brand:render`");
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

/** WCAG relative luminance of an `#rrggbb` colour. Same formula as `scripts/check-contrast.mjs`. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio across two colours, always >= 1. */
function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Sample the three plates of the rendered mark. The 240 px PNG is 100 × 62 units scaled by 2.4, so the
 * centres are exact: plate A at (31, 31), plate B at (69, 31), the lens at the overlap centre (50, 31).
 * The assets are opaque there; a transparent sample means the drawing moved and this check is blind.
 */
async function sampleMark(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Sample points as fractions of the canvas, so a change of master scale cannot silently move them onto the lens.
  // 0.12 / 0.88 of the width are inside the two plates only; 143/272 = 0.526 is the lens centre.
  const at = (ux, uy) => {
    const x = Math.round((ux / 100) * info.width);
    const y = Math.round((uy / 100) * info.height);
    const i = (y * info.width + x) * info.channels;
    return {
      x,
      y,
      alpha: data[i + 3],
      hex: `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    };
  };
  return { A: at(12, 50), B: at(88, 50), lens: at(52.6, 50) };
}

async function pngSize(path, expectedWidth = null, expectedHeight = null) {
  if (!existsSync(path)) {
    fail(path, "is missing — run `npm run brand:render` / `node scripts/render-pass-assets.mjs`");
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

/* Explicitly the file that was empty live. Kept separate so the failure names it. */
const passFace = join(PASS, "pass-face@2x.png");
if (existsSync(passFace) && statSync(passFace).size === 0) fail(passFace, "is 0 bytes — this is the live defect, not a warning");

/* 2 · the mark's geometry, read from the source numbers */
const mark = requireSvg(join(BRAND, "mark-venn.svg"));
if (mark) {
  const attr = (tag, name) => {
    // Anchored on whitespace: unanchored, `x="` also matches inside `rx="31.4"`, which read plate B's x as 0.
    const match = tag.match(new RegExp(`\\s${name}="([^"]+)"`));
    return match ? Number(match[1]) : null;
  };
  // Sorted by the letter: plate B is drawn first (so A sits on top), so document order is not plate order.
  const plates = [...mark.matchAll(/<rect[^>]*data-plate="([AB])"[^>]*>/g)]
    .map((m) => ({ tag: m[0], letter: m[1] }))
    .sort((p, q) => p.letter.localeCompare(q.letter))
    .map((p) => p.tag);
  if (plates.length !== 2) {
    fail(join(BRAND, "mark-venn.svg"), `has ${plates.length} plate(s), expected 2`);
  } else {
    const [a, b] = plates.map((tag) => ({
      x: attr(tag, "x"),
      width: attr(tag, "width"),
      height: attr(tag, "height"),
      radius: attr(tag, "rx"),
      fill: tag.match(/fill="([^"]+)"/)?.[1],
    }));
    if (a.width !== SPEC.plateAWidth || a.height !== SPEC.height || a.radius !== SPEC.radius) {
      fail(join(BRAND, "mark-venn.svg"), `plate A is ${a.width}x${a.height} r${a.radius}, spec is ${SPEC.plateAWidth}x${SPEC.height} r${SPEC.radius}`);
    }
    if (b.width !== SPEC.plateBWidth || b.height !== SPEC.height || b.radius !== SPEC.radius) {
      fail(join(BRAND, "mark-venn.svg"), `plate B is ${b.width}x${b.height} r${b.radius}, spec is ${SPEC.plateBWidth}x${SPEC.height} r${SPEC.radius}`);
    }
    for (const [name, plate] of [["A", a], ["B", b]]) {
      if (!plate.fill || plate.fill === "none") fail(join(BRAND, "mark-venn.svg"), `plate ${name} is not solid`);
    }
    if (a.fill && b.fill && a.fill.toLowerCase() === b.fill.toLowerCase()) {
      fail(join(BRAND, "mark-venn.svg"), `plates share fill ${a.fill} — the operator's construction is two saturated colours`);
    }
    if (b.x !== SPEC.plateBX) fail(join(BRAND, "mark-venn.svg"), `plate B is at x=${b.x}, spec x=${SPEC.plateBX}`);
    const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (Math.abs(overlap - SPEC.overlap) > 0.01) fail(join(BRAND, "mark-venn.svg"), `overlap is ${overlap}, spec ${SPEC.overlap}`);
  }
  if (!/data-lens="1"[^>]*d="[^"]*"/.test(mark)) {
    fail(join(BRAND, "mark-venn.svg"), "has no lens path — the state has nowhere to live");
  }
  if (/clip-path/.test(mark)) {
    fail(join(BRAND, "mark-venn.svg"), "the lens is clipped from a plate — it must be its own path, wider than the overlap");
  }
}
/** Measure the widest gold run in the centre row of a raster. The lens is the only gold element in the mark. */
async function goldRunPx(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const y = Math.floor(info.height / 2);
  let best = 0;
  let run = 0;
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    const gold = a > 128 && r > 200 && g > 140 && b < 80;
    run = gold ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

const mark29 = join(BRAND, "mark-venn-29.png");
if (existsSync(mark29) && statSync(mark29).size > 0) {
  const lens = await goldRunPx(mark29);
  if (lens < SPEC.lensFloor) fail(mark29, `lens is ${lens} px in the 29 px slot, floor is ${SPEC.lensFloor} px`);
  else console.log(`brand-assets: lens at 29 px = ${lens} px (floor ${SPEC.lensFloor})`);
  if (!/data-lens="1"/.test(mark)) fail(join(BRAND, "mark-venn.svg"), "lens element missing — it is a path now, not a clipped rect");
}

/**
 * 3 · contrast, sampled from the rendered pixels rather than inferred from the source fills (#460).
 *
 * Geometry passed while both plates were `#1A1F71`; the only thing that catches a one-blob mark is measuring
 * the pixels it actually produced. Plate B against plate A >= 1.6:1 is the operator's floor; the lens is held
 * to the same floor against both, which is what "clearly distinct" means as a number.
 */
const mark240 = join(BRAND, "mark-venn-240.png");
if (existsSync(mark240) && statSync(mark240).size > 0) {
  const samples = await sampleMark(mark240);
  const named = [["plate A", samples.A], ["plate B", samples.B], ["lens", samples.lens]];
  for (const [name, sample] of named) {
    if (sample.alpha !== 255) fail(mark240, `${name} sample at (${sample.x}, ${sample.y}) has alpha ${sample.alpha} — the drawing moved`);
  }
  if (named.every(([, sample]) => sample.alpha === 255)) {
    const plate = contrastRatio(samples.A.hex, samples.B.hex);
    const lensA = contrastRatio(samples.lens.hex, samples.A.hex);
    const lensB = contrastRatio(samples.lens.hex, samples.B.hex);
    console.log(
      `brand-assets: contrast on ${mark240} — plate B/A ${plate.toFixed(2)}:1 (floor ${SPEC.plateContrastFloor.toFixed(2)}), ` +
        `lens/A ${lensA.toFixed(2)}:1, lens/B ${lensB.toFixed(2)}:1 (floor ${SPEC.lensContrastFloor.toFixed(2)})`,
    );
    if (plate < SPEC.plateContrastFloor) {
      fail(
        mark240,
        `plate B (${samples.B.hex}) against plate A (${samples.A.hex}) is ${plate.toFixed(2)}:1, floor ${SPEC.plateContrastFloor.toFixed(2)}:1 — the plates have merged`,
      );
    }
    if (lensA < SPEC.lensContrastFloor) fail(mark240, `lens (${samples.lens.hex}) against plate A is ${lensA.toFixed(2)}:1, floor ${SPEC.lensContrastFloor.toFixed(2)}`);
    if (lensB < SPEC.lensContrastFloor) fail(mark240, `lens (${samples.lens.hex}) against plate B is ${lensB.toFixed(2)}:1, floor ${SPEC.lensContrastFloor.toFixed(2)}`);
  }
}

/* The 29 px Wallet icon is the other place the lens has to survive. */
const icon29 = join(PASS, "icon.png");
if (existsSync(icon29) && statSync(icon29).size > 0) {
  const lens = await goldRunPx(icon29);
  if (lens < SPEC.lensFloor) fail(icon29, `lens is ${lens} px in the 29 px pass icon, floor is ${SPEC.lensFloor} px`);
}

if (problems.length > 0) {
  console.error(`brand-assets: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("  run `npm run brand:render` and `node scripts/render-pass-assets.mjs`; if a problem survives that, the renderer and the spec disagree.");
  process.exit(1);
}

const assets = BRAND_PNGS.length + BRAND_SVGS.length + PASS_ASSETS.length + PASS_SVGS.length + (existsSync(MOCKS) ? readdirSync(MOCKS).filter((f) => FRAME_PATTERN.test(f)).length : 0) + 1;
console.log(`brand-assets: ${assets} asset(s) present, no empty files, two plates at x=0/x=${SPEC.plateBX}, overlap ${SPEC.overlap}, lens ${SPEC.lensWidth} (ratio ${SPEC.lensToOverlap.toFixed(3)}), plate and lens contrast measured, lens survives the 29 px slot`);
