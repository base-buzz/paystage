#!/usr/bin/env node
/**
 * Rasterise the Vouch pass assets from the one SVG master (#434).
 *
 *   node scripts/render-pass-assets.mjs                 # writes apps/console/public/pass/
 *   node scripts/render-pass-assets.mjs --out /tmp/pass # somewhere else
 *   node scripts/render-pass-assets.mjs --state REVOKED # the refused face, same layout
 *
 * The point of this file is that it **draws nothing**. Every shape comes from `scripts/lib/pass-face.mjs`, so the
 * asset uploaded to Wallet, the hero the lander renders and the 2x image an article embeds are three outputs of one
 * layout function and cannot drift into three drawings.
 *
 * Sizes are Apple's, from `docs/proposals/vouch-pass-face.md` (storeCard): strip 375×123 @1x (750×246 @2x), logo
 * 160×50, icon 29/58/87. The article mock is the whole face at 2× — a bare card on paper, never a phone frame,
 * because a mocked-up phone is a claim about an integration that has not shipped.
 *
 * Exit 0 wrote everything · 2 no usable font (a render with no font is a grid of tofu boxes, so this refuses
 * rather than shipping one) · 3 sharp is not installed · 4 a write failed.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  faceIdSheetSvg,
  mandatePageSvg,
  passFaceSvg,
  passIconSvg,
  passLogoSvg,
  passStripSvg,
  ticketMark,
  setupScreenSvg,
  stackedTeammatesSvg,
  PASS_TOKENS,
} from "./lib/pass-face.mjs";
import {
  cancelledSvg,
  capMidJobSvg,
  capRefusalSvg,
  failClosedSvg,
  invisibleCallsSvg,
  limitExhaustedSvg,
  passDeletedNotRevokedSvg,
  reviewArrivesSvg,
  revokeActionSvg,
  staleVsRevokedSvg,
  storyConfigureSvg,
  storyConfirmSvg,
  storyPickSvg,
  storyProvisionSvg,
  unknownSerialSvg,
} from "./lib/pass-story.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const OUT = resolve(arg("out", "apps/console/public/pass"));

/**
 * The second ceiling is a **window**, not a lifetime allowance: `packages/policy/src/schema.ts` has
 * `velocity.windows[] {window_seconds, max_amount, max_count, per_payee_max_amount}` and no total anywhere. So the
 * label is derived from the same seconds the evaluator reads, and cannot drift into the word "total" again.
 */
function windowLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "per window";
  // "per 1d" reads like a typo; a single day is 24h to everyone who says it out loud.
  if (seconds === 86400) return "per 24h";
  if (seconds % 86400 === 0) return `per ${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `per ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `per ${seconds / 60}m`;
  return `per ${seconds}s`;
}
const STATE = (arg("state", "ACTIVE") ?? "ACTIVE").toUpperCase();
if (!["ACTIVE", "REVOKED", "EXPIRED"].includes(STATE)) {
  console.error(`render-pass-assets: state must be ACTIVE, REVOKED or EXPIRED, got ${STATE}`);
  process.exit(2);
}

/**
 * A font is not optional. librsvg falls back to drawing tofu boxes and exits 0, which is how a "successful" render
 * shipped a grid of squares the first time this ran. Candidates are tried in order; the Next-compiled Noto Sans is
 * present in any installed workspace and is the reason this works in CI without vendoring a binary.
 */
const FONT_CANDIDATES = [
  join(process.cwd(), "scripts/assets/fonts"),
  join(process.cwd(), "apps/console/node_modules/next/dist/compiled/@vercel/og"),
];
const fontDir = FONT_CANDIDATES.find((dir) => existsSync(dir) && readdirSync(dir).some((f) => /\.(ttf|otf)$/i.test(f)));
if (!fontDir) {
  console.error(
    "render-pass-assets: no font found — a render without one is a grid of tofu boxes, so this refuses.\n" +
      `  looked in: ${FONT_CANDIDATES.join(", ")}\n` +
      "  fix: run `npm install` so Next's compiled Noto Sans is present, or drop a .ttf into scripts/assets/fonts/",
  );
  process.exit(2);
}
const confDir = join(tmpdir(), "paystage-pass-fonts");
mkdirSync(confDir, { recursive: true });
const conf = join(confDir, "fonts.conf");
writeFileSync(
  conf,
  `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${fontDir}</dir>\n  <cachedir>${join(confDir, "cache")}</cachedir>\n</fontconfig>\n`,
);
process.env.FONTCONFIG_FILE = conf;

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("render-pass-assets: sharp is not installed — run `npm install` (it is a dev dependency)");
  process.exit(3);
}

const revoked = STATE === "REVOKED";
const FACE = {
  state: STATE,
  limit: arg("limit", "$0.50"),
  expiry: arg("expiry", "31 Jan 2027"),
  // A figure uses a deliberate fictional entity: "you" in pixels reads as a placeholder bug (caught 2026-11-25).
  principal: arg("principal", "Northwind Ltd"),
  brand: arg("brand", "vouchguard"),
  serial: arg("serial", "vch-7F3"),
  fundedFrom: arg("funded-from", "test credits"),
  // v3: the poster carries the teammate's name, so a render has to know whose pass it is.
  teammate: {
    name: arg("teammate", "Grok Bot"),
    platform: arg("platform", "Grok"),
    category: arg("category", "research"),
  },
  window: `${arg("window-amount", "$20.00")} ${windowLabel(Number(arg("window-seconds", "86400")))}`,
};

/** every asset, with the size Apple asks for */
const ASSETS = [
  { file: "pass-face@2x.png", svg: () => passFaceSvg({ ...FACE, width: 750 }), expect: [750, 1035], note: "article mock, bare card at 2x" },
  { file: "strip.png", svg: () => passStripSvg({ width: 375, height: 123, revoked }), expect: [375, 123], note: "Wallet strip @1x" },
  { file: "strip@2x.png", svg: () => passStripSvg({ width: 750, height: 246, revoked }), expect: [750, 246], note: "Wallet strip @2x" },
  { file: "logo.png", svg: () => passLogoSvg({ width: 160, height: 50 }), expect: [160, 50], note: "Wallet logo" },
  { file: "icon.png", svg: () => passIconSvg({ width: 29, height: 29, revoked }), expect: [29, 29], note: "Wallet icon @1x" },
  { file: "icon@2x.png", svg: () => passIconSvg({ width: 58, height: 58, revoked }), expect: [58, 58], note: "Wallet icon @2x" },
  { file: "icon@3x.png", svg: () => passIconSvg({ width: 87, height: 87, revoked }), expect: [87, 87], note: "Wallet icon @3x" },
];

mkdirSync(OUT, { recursive: true });
const written = [];
for (const asset of ASSETS) {
  const svg = asset.svg();
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const meta = await sharp(png).metadata();
  if (meta.width !== asset.expect[0] || meta.height !== asset.expect[1]) {
    console.error(
      `render-pass-assets: ${asset.file} rendered ${meta.width}x${meta.height}, expected ${asset.expect.join("x")}`,
    );
    process.exit(4);
  }
  writeFileSync(join(OUT, asset.file), png);
  written.push(`${asset.file} ${meta.width}x${meta.height} — ${asset.note}`);
}

/**
 * The storyboard frames (#438) live beside the pass assets and are rendered from the same module, so the page at
 * `/mocks` cannot show a drawing that disagrees with the product. No QR is manufactured here either.
 */
if (argv.includes("--frames")) {
  const FRAMES = [
    { file: "frame-pass-active.png", svg: passFaceSvg({ ...FACE, width: 750, state: "ACTIVE", limit: "$2.00", window: "$20.00 per 24h" }), note: "the pass arrives" },
    { file: "frame-face-id.png", svg: faceIdSheetSvg({ width: 750 }), note: "iOS system sheet — we choose when, not how" },
    { file: "frame-mandate-page.png", svg: mandatePageSvg({ width: 750, state: STATE, limit: "$2.00", window: "$20.00 per 24h" }), note: "the page is the editor" },
    { file: "frame-pass-changed.png", svg: passFaceSvg({ ...FACE, width: 750, state: "ACTIVE", limit: "$4.00", window: "$40.00 per 24h" }), note: "the same pass after a change" },
    { file: "frame-pass-revoked.png", svg: passFaceSvg({ ...FACE, width: 750, state: "REVOKED", limit: "$2.00", window: "$20.00 per 24h" }), note: "ended, and the face says so" },
    { file: "frame-stack.png", svg: stackedTeammatesSvg({ width: 750 }), note: "four teammates, four caps, one principal" },
    { file: "frame-setup.png", svg: setupScreenSvg({ width: 750 }), note: "four presets, one tap — the numbers arrive filled in" },
    { file: "story1-pick.png", svg: storyPickSvg(), note: "Safari — pick the job" },
    { file: "story1-configure.png", svg: storyConfigureSvg(), note: "Safari — configure the numbers" },
    { file: "story1-confirm.png", svg: storyConfirmSvg(), note: "iOS system sheet — read back, then Face ID" },
    { file: "story1-provision.png", svg: storyProvisionSvg(), note: "Safari → Wallet — the hand-off" },
    { file: "story2-calls.png", svg: invisibleCallsSvg({ width: 750 }), note: "forty payments, no notification" },
    { file: "story2-refusal.png", svg: capRefusalSvg({ width: 750 }), note: "a refusal at the cap" },
    { file: "story2-review.png", svg: reviewArrivesSvg({ width: 750 }), note: "a review arriving" },
    { file: "story4-revoke.png", svg: revokeActionSvg({ width: 750 }), note: "one action, the name comes off" },
    { file: "story4-deleted.png", svg: passDeletedNotRevokedSvg({ width: 750 }), note: "deleting the pass is not revoking it" },
    { file: "story6-failclosed.png", svg: failClosedSvg({ width: 750 }), note: "service down — fail closed" },
    { file: "story6-cancelled.png", svg: cancelledSvg({ width: 750 }), note: "Face ID cancelled" },
    { file: "story6-stale.png", svg: staleVsRevokedSvg({ width: 750 }), note: "a stale image against a live endpoint" },
    { file: "story6-unknown.png", svg: unknownSerialSvg({ width: 750 }), note: "an unknown serial" },
    { file: "story6-429.png", svg: limitExhaustedSvg({ width: 750 }), note: "the free allowance runs out" },
    { file: "story6-capmid.png", svg: capMidJobSvg({ width: 750 }), note: "the cap arrives mid-job" },
  ];
  mkdirSync(OUT, { recursive: true });
  for (const frame of FRAMES) {
    const png = await sharp(Buffer.from(frame.svg)).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(join(OUT, frame.file), png);
    console.log(`  ${frame.file} — ${frame.note}`);
  }
  console.log(`render-pass-assets: ${FRAMES.length} storyboard frame(s) in ${OUT}`);
  process.exit(0);
}

/**
 * The poster mark for the HTML page (#440).
 *
 * The page is HTML and cannot call `ticketMark()`, so it renders this file instead. Generating it here — from the
 * same function the pass itself uses — is what makes "the mark top-left" the same mark rather than a second
 * drawing. The mark is drawn inverted (paper plates, state-coloured lens) because the page paints it over the
 * mandate's tint, where a deep plate would disappear.
 *
 * **The second plate is blended against the surface the page actually paints** (#460): the default poster tint for
 * the active mark, and `state.deadPlate` for revoked/expired, because `MandateCard` greys the poster for a dead
 * mandate. Without this the explicit blend would default to paper and the two white plates would merge on the
 * page, which is the same defect at a smaller scale.
 */
const MARKS = [
  ["mark-active.svg", "ACTIVE", PASS_TOKENS.posterTints[0]],
  ["mark-revoked.svg", "REVOKED", PASS_TOKENS.state.deadPlate],
  ["mark-expired.svg", "EXPIRED", PASS_TOKENS.state.deadPlate],
];
for (const [file, state, surface] of MARKS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${ticketMark({ x: 0, y: 19, size: 100, state, plate: "#FFFFFF", surface })}</svg>`;
  writeFileSync(join(OUT, file), svg);
  written.push(`${file} — the poster mark, drawn by ticketMark()`);
}

// The SVG beside the PNG, so the lander can inline exactly what was rasterised.
writeFileSync(join(OUT, "pass-face.svg"), passFaceSvg({ ...FACE, width: 750 }));

console.log(`render-pass-assets: ${written.length} asset(s) + the source SVG in ${OUT} (state ${STATE}, font ${fontDir})`);
for (const line of written) console.log(`  ${line}`);
