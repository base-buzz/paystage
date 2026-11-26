#!/usr/bin/env node
/**
 * The PayStage brand kit: the venn mark, its lockups, favicons and an OG card.
 *
 * Why a generator and not hand-drawn SVGs: the pass, the page and the apps must not drift, and the only thing
 * that has ever stopped drift here is one source of numbers. The geometry comes from `scripts/lib/venn.mjs`,
 * which is also what the Wallet pass and the verification page draw. The palette comes from
 * `apps/console/src/lib/pass-tokens.json` — the same file the wallet pass and the mandate page read.
 *
 * Output goes to `brand/` (source SVG + PNG exports). Picking an option is no longer a decision: the operator
 * chose the venn on 2026-11-27, and the seal was deleted rather than kept as a second drawing.
 *
 *   node scripts/brand-kit.mjs            # write brand/
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VENN, VENN_INK, VENN_MONO, VENN_SURFACES, lensPx, vennGroup } from "./lib/venn.mjs";

/**
 * Fonts before sharp, or every label on the contact sheets is a row of tofu boxes. Same source the pass renderer
 * uses: Next's compiled Noto Sans. This is not decoration — a sheet whose labels are boxes is unreviewable.
 */
const FONT_CANDIDATES = [
  "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf",
  "apps/console/node_modules/next/dist/compiled/@vercel/og",
  "node_modules/next/dist/compiled/@vercel/og",
];
const fontDir = FONT_CANDIDATES.find((d) => existsSync(d) && (d.endsWith(".ttf") || readdirSync(d).some((f) => /\.(ttf|otf)$/i.test(f))));
if (fontDir) {
  const dir = fontDir.endsWith(".ttf") ? join(fontDir, "..") : fontDir;
  const confDir = join(tmpdir(), "paystage-brand-fonts");
  mkdirSync(confDir, { recursive: true });
  const conf = join(confDir, "fonts.conf");
  writeFileSync(conf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${dir}</dir>\n  <cachedir>${join(confDir, "cache")}</cachedir>\n</fontconfig>\n`);
  process.env.FONTCONFIG_FILE = conf;
} else {
  console.error("brand-kit: no font found — contact-sheet labels would be tofu boxes; looked in " + FONT_CANDIDATES.join(", "));
  process.exit(2);
}

const sharp = (await import("sharp")).default;
import TOKENS from "../apps/console/src/lib/pass-tokens.json" with { type: "json" };

const { ink: INK, deep: DEEP, gold: GOLD, muted: MUTED, red: RED } = TOKENS.palette;
const PAPER = "#FFFFFF";
const SANS = "Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif";
const WORDMARK = "PayStage";
const OUT = "brand";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ------------------------------------------------ the mark ------------------------------------------------------ */

/**
 * `markVenn()` is the lead mark, replacing the seal. Plate A is 100% ink, plate B is 62% of it over the
 * surface, and the lens is the only differentiated element (#460). The seal is gone: nothing references it
 * any more, and a kept fallback is how two drawings start.
 *
 * `size` is the mark's **width** in px. The mark is 100 × 62, so a 29 px render is 29 × 18 and its lens is
 * 24/100 × 29 = 6.96 px wide at the centre — the number the 29 px icon slot is judged on.
 *
 * `surface` is the colour the transparent PNG will be seen on: paper for the brand kit, ink for the inverse
 * row of the contact sheet, deep for the tiles. Plate B is blended against it explicitly (see `venn.mjs`)
 * rather than left as an SVG opacity, so the raster does not change with the viewer's page background.
 */
function markVenn({
  size = 240,
  plate = VENN_INK.plateA,
  plateB = VENN_INK.plateB,
  lens = VENN_INK.lens,
  background = null,
  surface = background ?? VENN_SURFACES.paper,
  state = "ACTIVE",
} = {}) {
  const w = Number(size);
  const h = Math.round((w * VENN.height) / VENN.width);
  const bg = background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : "";
  // The wrapper's viewBox already maps 272×153 into w×h, so the group is drawn at its own scale — scaling it twice
  // rendered the mark at ~3 px inside a 29 px canvas, which is how the icon slot goes blank.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${VENN.width} ${VENN.height}" role="img" aria-label="PayStage venn, ${String(state).toLowerCase()}">
  ${bg}${vennGroup({ width: VENN.width, plate, plateB, lens, surface })}
</svg>`;
}

/** A square app/favicon tile: the mark inverted so it reads on the deep field. */
function markTile({ size = 512, plate = PAPER, lens = GOLD, background = DEEP } = {}) {
  const s = Number(size);
  const markW = s * 0.86;
  const markH = (markW * VENN.height) / VENN.width;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" role="img" aria-label="PayStage venn">
  <rect width="${s}" height="${s}" rx="${s * 0.22}" fill="${background}"/>
  ${vennGroup({ x: (s - markW) / 2, y: (s - markH) / 2, width: markW, plate, lens, surface: background })}
</svg>`;
}

/* ------------------------------------------------ wordmarks and lockups ------------------------------------------ */

function wordmark({ width = 900, mode = "solid" }) {
  const h = Math.round(width * 0.28);
  const size = Math.round(h * 0.62);
  const text = (x, fill, t) =>
    `<text x="${x}" y="${Math.round(h * 0.68)}" font-family="${SANS}" font-size="${size}" font-weight="700"
      letter-spacing="${-size * 0.02}" fill="${fill}" stroke="${fill}" stroke-width="${size * 0.019}">${esc(t)}</text>`;
  const parts =
    mode === "solid"
      ? text(size * 0.1, INK, WORDMARK) + `<circle cx="${size * 0.1 + size * 2.72}" cy="${Math.round(h * 0.68)}" r="${size * 0.075}" fill="${GOLD}"/>`
      : mode === "split"
        ? text(size * 0.1, INK, "Pay") + text(size * 0.1 + size * 1.62, MUTED, "Stage")
        : text(size * 0.1, INK, WORDMARK);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
    <rect width="${width}" height="${h}" fill="${PAPER}"/>${parts}</svg>`;
}

/**
 * Vertical lockup, Mastercard construction: symbol above, wordmark beneath, wordmark width = symbol width.
 * `textLength` pins the wordmark to the symbol's width for any name, so the lockup stays right without measuring.
 */
function lockupVertical({ width = 900, markWidth = 560, plate = VENN_INK.plateA, plateB = VENN_INK.plateB, lens = VENN_INK.lens, ink = INK, background = PAPER } = {}) {
  const W = Number(markWidth);
  const markH = (W * VENN.height) / VENN.width;
  const pad = Math.round(W * 0.1);
  const gap = Math.round(markH * 0.168);
  const wordSize = Math.round(W * 0.17);
  const subSize = Math.round(wordSize * 0.32);
  const h = Math.round(pad + markH + gap + wordSize * 1.05 + subSize * 1.8 + pad);
  const cx = Number(width) / 2;
  const wordY = Math.round(pad + markH + gap + wordSize * 0.8);
  const subY = Math.round(wordY + subSize * 1.9);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
  <rect width="${width}" height="${h}" fill="${background}"/>
  ${vennGroup({ x: (Number(width) - W) / 2, y: pad, width: W, plate, plateB: plateB ?? undefined, lens, surface: background })}
  <text x="${cx}" y="${wordY}" text-anchor="middle" font-family="${SANS}" font-size="${wordSize}" font-weight="700"
        letter-spacing="${-wordSize * 0.02}" fill="${ink}" stroke="${ink}" stroke-width="${wordSize * 0.019}"
        textLength="${W}" lengthAdjust="spacingAndGlyphs">${esc(WORDMARK)}</text>
  <text x="${cx}" y="${subY}" text-anchor="middle" font-family="${SANS}" font-size="${subSize}" font-weight="600"
        letter-spacing="${subSize * 0.06}" fill="${MUTED}">agent spending mandates</text>
</svg>`;
}

/** Horizontal lockup: mark left, wordmark right, gap = 0.5 × mark width. For headers and narrow contexts. */
function lockupHorizontal({ width = 1200, markWidth = 260, plate = VENN_INK.plateA, plateB = VENN_INK.plateB, lens = VENN_INK.lens, ink = INK, background = PAPER } = {}) {
  const W = Number(markWidth);
  const markH = (W * VENN.height) / VENN.width;
  const gap = Math.round(W * 0.5);
  const wordSize = Math.round(W * 0.46);
  const h = Math.round(Math.max(markH, wordSize * 1.3) + W * 0.5);
  const x = Math.round((Number(width) - (W + gap + wordSize * 5.1)) / 2);
  const markY = Math.round((h - markH) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
  <rect width="${width}" height="${h}" fill="${background}"/>
  ${vennGroup({ x, y: markY, width: W, plate, plateB: plateB ?? undefined, lens, surface: background })}
  <text x="${x + W + gap}" y="${Math.round(h / 2 + wordSize * 0.36)}" font-family="${SANS}" font-size="${wordSize}"
        font-weight="700" letter-spacing="${-wordSize * 0.02}" fill="${ink}" stroke="${ink}"
        stroke-width="${wordSize * 0.019}">${esc(WORDMARK)}</text>
</svg>`;
}

/**
 * One-colour: ink plates at 100% / 40%, paper lens (a knockout), ink wordmark. For print, stamps and
 * single-colour contexts. The second plate is a second *value* of the same ink, not a second colour.
 */
function lockupMono({ width = 1200, markWidth = 260 } = {}) {
  return lockupHorizontal({ width, markWidth, plate: VENN_MONO.plateA, plateB: VENN_MONO.plateB, lens: VENN_MONO.lens, ink: INK, background: PAPER });
}

/* ------------------------------------------------ write ---------------------------------------------------------- */

/**
 * Remove only generated files, never the directory. `brand/` also holds BRAND.md, AGENTS.md and REVIEW.md —
 * the human and agent parts of the kit — and a generator that wipes its own documentation is a data-loss bug.
 */
if (existsSync(OUT)) {
  for (const file of readdirSync(OUT)) {
    if (/^(mark|lockup|favicon|sheet|wordmark|og)-.*\.(svg|png)$/.test(file)) rmSync(join(OUT, file), { force: true });
  }
}
mkdirSync(OUT, { recursive: true });
const written = [];

/** The mark at the sizes the brand is actually seen at. `29` is the icon slot; `16` is the floor. */
const MARK_SIZES = [240, 120, 60, 29, 16];
const STATES = [
  ["", "ACTIVE", GOLD],
  ["-revoked", "REVOKED", RED],
  ["-expired", "EXPIRED", MUTED],
];
for (const [suffix, state, lens] of STATES) {
  const svg = markVenn({ size: 240, plate: VENN_INK.plateA, plateB: VENN_INK.plateB, lens, state });
  writeFileSync(join(OUT, `mark-venn${suffix}.svg`), svg);
  written.push(join(OUT, `mark-venn${suffix}.svg`));
}
for (const px of MARK_SIZES) {
  await sharp(Buffer.from(markVenn({ size: px }))).png().toFile(join(OUT, `mark-venn-${px}.png`));
  written.push(join(OUT, `mark-venn-${px}.png`));
}
// One-colour proof: ink plates at 100% / 40%, paper lens. A separate file, not a mode switch on the live mark.
writeFileSync(
  join(OUT, "mark-venn-mono.svg"),
  markVenn({ size: 240, plate: VENN_MONO.plateA, plateB: VENN_MONO.plateB, lens: VENN_MONO.lens, background: PAPER, surface: PAPER, state: "MONO" }),
);
written.push(join(OUT, "mark-venn-mono.svg"));

for (const mode of ["solid", "split", "plain"]) {
  const svg = wordmark({ mode });
  writeFileSync(join(OUT, `wordmark-${mode}.svg`), svg);
  written.push(join(OUT, `wordmark-${mode}.svg`));
}

const VERTICAL = lockupVertical({});
writeFileSync(join(OUT, "lockup-vertical.svg"), VERTICAL);
written.push(join(OUT, "lockup-vertical.svg"));
await sharp(Buffer.from(VERTICAL)).png().toFile(join(OUT, "lockup-vertical.png"));

const HORIZONTAL = lockupHorizontal({});
writeFileSync(join(OUT, "lockup-horizontal.svg"), HORIZONTAL);
written.push(join(OUT, "lockup-horizontal.svg"));
await sharp(Buffer.from(HORIZONTAL)).png().toFile(join(OUT, "lockup-horizontal.png"));

const MONO = lockupMono({});
writeFileSync(join(OUT, "lockup-mono.svg"), MONO);
written.push(join(OUT, "lockup-mono.svg"));
await sharp(Buffer.from(MONO)).png().toFile(join(OUT, "lockup-mono.png"));

/* favicons from the mark tile — the mark alone, inverted on the deep field */
for (const px of [16, 32, 48, 180, 512]) {
  await sharp(Buffer.from(markTile({ size: px }))).resize(px, px).png().toFile(join(OUT, `favicon-${px}.png`));
}

/* OG card, 1200x630 */
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect x="0" y="0" width="1200" height="10" fill="${GOLD}"/>
  <g transform="translate(80 96)">${vennGroup({ width: 150, plate: VENN_INK.plateA, plateB: VENN_INK.plateB, lens: VENN_INK.lens, surface: PAPER })}</g>
  <text x="262" y="176" font-family="${SANS}" font-size="64" font-weight="700" letter-spacing="-1.3" fill="${INK}" stroke="${INK}" stroke-width="1.2">PayStage</text>
  <text x="80" y="330" font-family="${SANS}" font-size="56" font-weight="700" letter-spacing="-1.2" fill="${INK}" stroke="${INK}" stroke-width="1">Stop the payment before it&#8217;s signed.</text>
  <text x="80" y="392" font-family="${SANS}" font-size="28" font-weight="500" fill="${MUTED}">A read-only gate for x402 payments on Base.</text>
  <text x="80" y="560" font-family="${SANS}" font-size="24" font-weight="600" letter-spacing="2.4" fill="${DEEP}">PAYSTAGE.XYZ</text>
  <g transform="translate(980 470)">${vennGroup({ width: 120, plate: VENN_INK.plateA, plateB: VENN_INK.plateB, lens: VENN_INK.lens, surface: PAPER })}</g>
</svg>`;
writeFileSync(join(OUT, "og-1200x630.svg"), og);
await sharp(Buffer.from(og)).png().toFile(join(OUT, "og-1200x630.png"));

await contactSheet();
console.log(`brand-kit: wrote ${written.length} SVG source(s) + PNG exports to ${OUT}/`);
console.log(`brand-kit: mark = venn (operator construction: 272×153, plates 175/166 rx48 at x=0/106, lens a path 120 wide — wider than the 69 overlap); lens ${lensPx(29).toFixed(2)} px at 29 px (floor 3)`);

/* ------------------------------------------------ contact sheet --------------------------------------------------- */

/**
 * One sheet showing the mark at the sizes it will actually be seen at (240, 120, 60, 29, 16 px), on paper and
 * on ink. A logo that only works at 240 is not a logo, and this is the only way to see that before it ships.
 */
async function contactSheet() {
  const tiles = [];
  for (const px of [240, 120, 60, 29, 16]) {
    const onPaper = await sharp(Buffer.from(markVenn({ size: px, plate: VENN_INK.plateA, plateB: VENN_INK.plateB, lens: VENN_INK.lens, surface: PAPER }))).png().toBuffer();
    const onInk = await sharp(Buffer.from(markVenn({ size: px, plate: PAPER, lens: GOLD, surface: INK }))).png().toBuffer();
    tiles.push({ px, onPaper, onInk });
  }
  const W = 1180;
  const H = 520;
  const base = sharp({ create: { width: W, height: H, channels: 4, background: PAPER } });
  // The bottom row is shown on ink; a paper plate disappears on the sheet itself.
  const band = await sharp({ create: { width: W, height: 220, channels: 4, background: INK } }).png().toBuffer();
  const composites = [{ input: band, left: 0, top: 300 }];
  let x = 40;
  for (const t of tiles) {
    composites.push({ input: t.onPaper, left: x, top: 100 });
    composites.push({ input: t.onInk, left: x, top: 340 });
    x += t.px + 40;
  }
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="0" y="260" width="${W}" height="40" fill="${INK}"/>
      <text x="40" y="56" font-family="${SANS}" font-size="30" font-weight="700" fill="${INK}">the venn — two plates, one value apart, lens = state</text>
      <text x="40" y="288" font-family="${SANS}" font-size="18" fill="${PAPER}">240 · 120 · 60 · 29 · 16 px — 29 is the icon slot; the lens is ${lensPx(29).toFixed(2)} px there (floor 3)</text>
      <text x="40" y="${H - 24}" font-family="${SANS}" font-size="18" fill="#B9BFCC">top: on paper · bottom: on ink · gold = active; red = revoked; grey = expired; paper knockout = one colour</text>
    </svg>`,
  );
  composites.push({ input: label, left: 0, top: 0 });
  await base.composite(composites).png().toFile(join(OUT, "sheet-venn.png"));
}
