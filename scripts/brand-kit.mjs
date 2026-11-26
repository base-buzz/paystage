#!/usr/bin/env node
/**
 * The PayStage brand kit: three mark options, three lockups, favicons and an OG card.
 *
 * Why a generator and not nine hand-drawn SVGs: the pass, the page and the apps must not drift, and the only thing
 * that has ever stopped drift here is one source of numbers. The palette comes from
 * `apps/console/src/lib/pass-tokens.json` — the same file the wallet pass and the mandate page read.
 *
 * Output goes to `brand/` (source SVG + PNG contact sheets). Nothing is wired into the site by this script; picking an
 * option is an operator decision and the wiring is a separate commit.
 *
 *   node scripts/brand-kit.mjs            # write brand/
 *   node scripts/brand-kit.mjs --sheet    # also write the review contact sheet PNGs
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const OUT = "brand";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ------------------------------------------------ marks (three options) ------------------------------------------ */

/** 1 · The seal. Continuity with the product: this is the shape on the pass face. */
function markSeal({ size = 256, bg = DEEP, fg = PAPER, accent = GOLD }) {
  const s = size;
  /** Below 48 px a hairline stroke is a grey smudge. The mark thickens rather than turning to mush. */
  const w = s <= 48 ? 1.7 : 1;
  const r = s * 0.22;
  const notch = s * 0.30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${r}" fill="${bg}"/>
    <rect x="${s * 0.26}" y="${s * 0.26}" width="${s * 0.48}" height="${s * 0.48}" rx="${s * 0.10}" fill="none" stroke="${fg}" stroke-width="${s * 0.055 * w}"/>
    <path d="M${s * 0.50} ${s * 0.26} v${notch * 0.42}" stroke="${accent}" stroke-width="${s * 0.055 * w}" stroke-linecap="round"/>
    <circle cx="${s * 0.50}" cy="${s * 0.62}" r="${s * 0.075 * (s <= 48 ? 1.35 : 1)}" fill="${accent}"/>
  </svg>`;
}

/** 2 · The monogram. A bold P whose counter is a gold bar — the mark that survives 16 px. */
function markMono({ size = 256, bg = DEEP, fg = PAPER, accent = GOLD }) {
  const s = size;
  const w = s <= 48 ? 1.45 : 1;
  const r = s * 0.22;
  const stem = s * 0.115 * (s <= 48 ? 1.45 : 1);
  const x = s * 0.30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${r}" fill="${bg}"/>
    <path d="M${x} ${s * 0.78} V${s * 0.24} h${s * 0.16}
             a${s * 0.19} ${s * 0.19} 0 0 1 0 ${s * 0.38} h${-s * 0.16}"
          fill="none" stroke="${fg}" stroke-width="${stem}" stroke-linejoin="round" stroke-linecap="round"/>
    <rect x="${x + s * 0.02}" y="${s * 0.405}" width="${s * 0.20}" height="${s * 0.055}" rx="${s * 0.027}" fill="${accent}"/>
  </svg>`;
}

/** 3 · The pass. A card with one corner clipped and a stripe: the object, not the concept. */
function markPass({ size = 256, bg = DEEP, fg = PAPER, accent = GOLD }) {
  const s = size;
  const w = s <= 48 ? 1.7 : 1;
  const r = s * 0.22;
  const c = s * 0.30; // clipped corner size
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" rx="${r}" fill="${bg}"/>
    <path d="M${s * 0.24} ${s * 0.32} h${s * 0.36} l${c * 0.55} ${c * 0.55} v${s * 0.21} h${-s * 0.52} z"
      fill="none" stroke="${fg}" stroke-width="${s * 0.05 * w}" stroke-linejoin="round"/>
    <path d="M${s * 0.24} ${s * 0.32} h${s * 0.52}" stroke="${accent}" stroke-width="${s * 0.055 * w}" stroke-linecap="round"/>
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
      ? text(size * 0.1, INK, "PayStage") + `<circle cx="${size * 0.1 + size * 2.72}" cy="${Math.round(h * 0.68)}" r="${size * 0.075}" fill="${GOLD}"/>`
      : mode === "split"
        ? text(size * 0.1, INK, "Pay") + text(size * 0.1 + size * 1.62, MUTED, "Stage")
        : text(size * 0.1, INK, "PayStage");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
    <rect width="${width}" height="${h}" fill="${PAPER}"/>${parts}</svg>`;
}

function lockup({ width = 1200, mark, markSize = 220 }) {
  const h = Math.round(markSize * 1.25);
  const gap = Math.round(markSize * 0.34);
  const size = Math.round(markSize * 0.66);
  const x = markSize + gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
    <rect width="${width}" height="${h}" fill="${PAPER}"/>
    <g transform="translate(0 ${Math.round((h - markSize) / 2)})">${mark.replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>
    <text x="${x}" y="${Math.round(h / 2 + size * 0.36)}" font-family="${SANS}" font-size="${size}" font-weight="700"
      letter-spacing="${-size * 0.02}" fill="${INK}" stroke="${INK}" stroke-width="${size * 0.019}">PayStage</text>
  </svg>`;
}

/* ------------------------------------------------ dark variants -------------------------------------------------- */

const dark = (svg) => svg.replace(/fill="#FFFFFF"\/><\/svg>/g, `fill="${INK}"/></svg>`);

/* ------------------------------------------------ write ---------------------------------------------------------- */

const marks = [
  ["seal", markSeal],
  ["mono", markMono],
  ["pass", markPass],
];

mkdirSync(OUT, { recursive: true });
const written = [];

for (const [name, fn] of marks) {
  for (const [tone, bg] of [["light", DEEP], ["dark", INK]]) {
    const svg = fn({ size: 256, bg });
    const file = join(OUT, `mark-${name}-${tone}.svg`);
    writeFileSync(file, svg);
    written.push(file);
    await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(join(OUT, `mark-${name}-${tone}.png`));
  }
}

for (const mode of ["solid", "split", "plain"]) {
  const svg = wordmark({ mode });
  writeFileSync(join(OUT, `wordmark-${mode}.svg`), svg);
  written.push(join(OUT, `wordmark-${mode}.svg`));
}

for (const [name, fn] of marks) {
  const svg = lockup({ mark: fn({ size: 220 }) });
  writeFileSync(join(OUT, `lockup-${name}.svg`), svg);
  written.push(join(OUT, `lockup-${name}.svg`));
  // Rendered here, not later: sharp only sees the font through this process's FONTCONFIG_FILE.
  await sharp(Buffer.from(svg)).png().toFile(join(OUT, `lockup-${name}.png`));
}

/* favicons from the seal — the option that matches the product, until one is chosen */
const favSource = markSeal({ size: 512 });
for (const px of [16, 32, 48, 180, 512]) {
  await sharp(Buffer.from(favSource)).resize(px, px).png().toFile(join(OUT, `favicon-${px}.png`));
}

/* OG card, 1200x630 */
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect x="0" y="0" width="1200" height="10" fill="${GOLD}"/>
  <g transform="translate(80 96)">${markSeal({ size: 120 }).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>
  <text x="228" y="176" font-family="${SANS}" font-size="64" font-weight="700" letter-spacing="-1.3" fill="${INK}" stroke="${INK}" stroke-width="1.2">PayStage</text>
  <text x="80" y="330" font-family="${SANS}" font-size="56" font-weight="700" letter-spacing="-1.2" fill="${INK}" stroke="${INK}" stroke-width="1">Stop the payment before it&#8217;s signed.</text>
  <text x="80" y="392" font-family="${SANS}" font-size="28" font-weight="500" fill="${MUTED}">A read-only gate for x402 payments on Base.</text>
  <text x="80" y="560" font-family="${SANS}" font-size="24" font-weight="600" letter-spacing="2.4" fill="${DEEP}">PAYSTAGE.XYZ</text>
  <g transform="translate(980 470)">${markPass({ size: 96, bg: DEEP }).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>
</svg>`;
writeFileSync(join(OUT, "og-1200x630.svg"), og);
await sharp(Buffer.from(og)).png().toFile(join(OUT, "og-1200x630.png"));

await contactSheets();
console.log(`brand-kit: wrote ${written.length} SVG source(s) + PNG exports to ${OUT}/`);
console.log("brand-kit: mark options = seal (matches the pass face), mono (the P), pass (the object)");

/* ------------------------------------------------ contact sheet --------------------------------------------------- */

/**
 * One image per mark, showing it at the sizes it will actually be seen at (512, 96, 32, 16) on paper and on ink.
 * A logo that only works at 512 is not a logo, and this is the only way to see that before it ships.
 */
async function contactSheets() {
  const { default: sharpMod } = await import("sharp");
  const items = [];
  for (const [name, fn] of marks) {
    const tiles = [];
    for (const px of [256, 96, 48, 32, 16]) {
      const svg = fn({ size: px, bg: DEEP });
      const png = await sharpMod(Buffer.from(svg)).png().toBuffer();
      tiles.push({ png, px });
    }
    const W = 980;
    const H = 460;
    const base = sharpMod({ create: { width: W, height: H, channels: 4, background: PAPER } });
    const composites = [];
    let x = 40;
    for (const t of tiles) {
      composites.push({ input: t.png, left: x, top: 90 });
      x += t.px + 40;
    }
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <text x="40" y="56" font-family="${SANS}" font-size="30" font-weight="700" fill="${INK}">${name}</text>
        <text x="40" y="${H - 40}" font-family="${SANS}" font-size="18" fill="${MUTED}">256 · 96 · 48 · 32 · 16 px — the last three are the favicon sizes</text>
      </svg>`,
    );
    composites.push({ input: label, left: 0, top: 0 });
    await base.composite(composites).png().toFile(join(OUT, `sheet-${name}.png`));
    items.push(name);
  }
  return items;
}
