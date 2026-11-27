#!/usr/bin/env node
/**
 * The PayStage brand kit: the ticket mark, its three tiers, lockups, favicons and an OG card.
 *
 * Why a generator and not hand-drawn SVGs: the pass, the page and the apps must not drift, and the only thing that has
 * ever stopped drift here is one source of numbers. The geometry comes from `scripts/lib/mark.mjs`, which is also what
 * the Wallet pass, the verification page and the storyboard draw. The palette for text comes from
 * `apps/console/src/lib/pass-tokens.json` — the same file the wallet pass reads.
 *
 * The mark's own colours are **not** the page tokens: teal ticket `#1A5F7A`, white ink, red/grey state inks. Amber is
 * deliberately absent from everything here; gold belongs to the site and the pass face, never to the logo.
 *
 * Output goes to `brand/`: source SVGs plus PNG exports. The full/reduced/icon tiers are separate drawings chosen by
 * width, not by a flag at render time.
 *
 *   node scripts/brand-kit.mjs            # write brand/
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARK, MARK_COLOURS, ticketGroup, ticketSvg, tileSvg } from "./lib/mark.mjs";

/**
 * Fonts before sharp, or every label on the contact sheets is a row of tofu boxes. Same source the pass renderer uses:
 * Next's compiled Noto Sans. This is not decoration — a sheet whose labels are boxes is unreviewable.
 */
const FONT_CANDIDATES = [
  "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf",
  "apps/console/node_modules/next/dist/compiled/@vercel/og",
  "node_modules/next/dist/compiled/@vercel/og",
];
const fontDir = FONT_CANDIDATES.find(
  (d) => existsSync(d) && (d.endsWith(".ttf") || readdirSync(d).some((f) => /\.(ttf|otf)$/i.test(f))),
);
if (fontDir) {
  const dir = fontDir.endsWith(".ttf") ? join(fontDir, "..") : fontDir;
  const confDir = join(tmpdir(), "paystage-brand-fonts");
  mkdirSync(confDir, { recursive: true });
  const conf = join(confDir, "fonts.conf");
  writeFileSync(
    conf,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${dir}</dir>\n  <cachedir>${join(confDir, "cache")}</cachedir>\n</fontconfig>\n`,
  );
  process.env.FONTCONFIG_FILE = conf;
} else {
  console.error("brand-kit: no font found — contact-sheet labels would be tofu boxes; looked in " + FONT_CANDIDATES.join(", "));
  process.exit(2);
}

const sharp = (await import("sharp")).default;
import TOKENS from "../apps/console/src/lib/pass-tokens.json" with { type: "json" };

const { ink: INK, deep: DEEP, muted: MUTED } = TOKENS.palette;
const PAPER = MARK_COLOURS.paper;
const TEAL = MARK_COLOURS.body;
const SANS = "Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif";
const WORDMARK = "PayStage";
const OUT = "brand";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const h = (w) => Math.round((w * MARK.height) / MARK.width);

/* ------------------------------------------------ wordmarks and lockups ------------------------------------------ */

function wordmark({ width = 900, mode = "solid" }) {
  const height = Math.round(width * 0.28);
  const size = Math.round(height * 0.62);
  const text = (x, fill, t) =>
    `<text x="${x}" y="${Math.round(height * 0.68)}" font-family="${SANS}" font-size="${size}" font-weight="700"
      letter-spacing="${-size * 0.02}" fill="${fill}" stroke="${fill}" stroke-width="${size * 0.019}">${esc(t)}</text>`;
  const parts =
    mode === "solid"
      ? text(size * 0.1, INK, WORDMARK) +
        `<circle cx="${size * 0.1 + size * 2.72}" cy="${Math.round(height * 0.68)}" r="${size * 0.075}" fill="${TEAL}"/>`
      : mode === "split"
        ? text(size * 0.1, INK, "Pay") + text(size * 0.1 + size * 1.62, MUTED, "Stage")
        : text(size * 0.1, INK, WORDMARK);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${PAPER}"/>${parts}</svg>`;
}

/**
 * Vertical lockup, Mastercard construction: symbol above, wordmark beneath, wordmark width = symbol width.
 * `textLength` pins the wordmark to the symbol's width for any name, so the lockup stays right without measuring.
 */
function lockupVertical({ width = 900, markWidth = 560, mono = false, ink = INK, background = PAPER } = {}) {
  const W = Number(markWidth);
  const markH = h(W);
  const pad = Math.round(W * 0.1);
  const gap = Math.round(markH * 0.168);
  const wordSize = Math.round(W * 0.17);
  const subSize = Math.round(wordSize * 0.32);
  const height = Math.round(pad + markH + gap + wordSize * 1.05 + subSize * 1.8 + pad);
  const cx = Number(width) / 2;
  const wordY = Math.round(pad + markH + gap + wordSize * 0.8);
  const subY = Math.round(wordY + subSize * 1.9);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  ${ticketGroup({ x: (Number(width) - W) / 2, y: pad, width: W, mono, strokeScale: 1 })}
  <text x="${cx}" y="${wordY}" text-anchor="middle" font-family="${SANS}" font-size="${wordSize}" font-weight="700"
        letter-spacing="${-wordSize * 0.02}" fill="${ink}" stroke="${ink}" stroke-width="${wordSize * 0.019}"
        textLength="${W}" lengthAdjust="spacingAndGlyphs">${esc(WORDMARK)}</text>
  <text x="${cx}" y="${subY}" text-anchor="middle" font-family="${SANS}" font-size="${subSize}" font-weight="600"
        letter-spacing="${subSize * 0.06}" fill="${MUTED}">agent spending mandates</text>
</svg>`;
}

/** Horizontal lockup: mark left, wordmark right, gap = 0.5 × mark width. For headers and narrow contexts. */
function lockupHorizontal({ width = 1200, markWidth = 260, mono = false, ink = INK, background = PAPER } = {}) {
  const W = Number(markWidth);
  const markH = h(W);
  const gap = Math.round(W * 0.5);
  const wordSize = Math.round(W * 0.46);
  const height = Math.round(Math.max(markH, wordSize * 1.3) + W * 0.5);
  const x = Math.round((Number(width) - (W + gap + wordSize * 5.1)) / 2);
  const markY = Math.round((height - markH) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  ${ticketGroup({ x, y: markY, width: W, mono, strokeScale: 1 })}
  <text x="${x + W + gap}" y="${Math.round(height / 2 + wordSize * 0.36)}" font-family="${SANS}" font-size="${wordSize}"
        font-weight="700" letter-spacing="${-wordSize * 0.02}" fill="${ink}" stroke="${ink}"
        stroke-width="${wordSize * 0.019}">${esc(WORDMARK)}</text>
</svg>`;
}

/* ------------------------------------------------ write ---------------------------------------------------------- */

/**
 * Remove only generated files, never the directory. `brand/` also holds BRAND.md, AGENTS.md and REVIEW.md — the human
 * and agent parts of the kit — and a generator that wipes its own documentation is a data-loss bug.
 */
if (existsSync(OUT)) {
  for (const file of readdirSync(OUT)) {
    if (/^(mark|lockup|favicon|sheet|wordmark|og)-.*\.(svg|png)$/.test(file)) rmSync(join(OUT, file), { force: true });
  }
}
mkdirSync(OUT, { recursive: true });
const written = [];

/**
 * Source SVGs. The full and reduced files carry the same master grid; the reduced one is the same drawing with the
 * print stroke thickened, which is what "three drawings" means here. The icon file is the square tile.
 */
const svgSources = [
  ["mark-full.svg", ticketSvg({ width: MARK.width, state: "active" })],
  ["mark-full-revoked.svg", ticketSvg({ width: MARK.width, state: "revoked" })],
  ["mark-full-expired.svg", ticketSvg({ width: MARK.width, state: "expired" })],
  ["mark-full-mono.svg", ticketSvg({ width: MARK.width, mono: true })],
  ["mark-reduced.svg", ticketSvg({ width: 89, state: "active" })],
  ["mark-icon.svg", tileSvg({ size: 87 })],
];
for (const [file, svg] of svgSources) {
  writeFileSync(join(OUT, file), svg);
  written.push(join(OUT, file));
}

/**
 * Rasters at the sizes the brand is actually seen at. 142 is the full floor, 89/64 are the reduced tier, 29/58/87 are
 * PassKit's icon slots. 240 is the marketing size. The tier is inferred from the width by `ticketSvg`.
 */
const TICKET_PNGS = [
  ["mark-full-240.png", 240],
  ["mark-full-142.png", 142],
  ["mark-reduced-89.png", 89],
  ["mark-reduced-64.png", 64],
];
for (const [file, px] of TICKET_PNGS) {
  await sharp(Buffer.from(ticketSvg({ width: px, state: "active" }))).png().toFile(join(OUT, file));
  written.push(join(OUT, file));
}

/** The same three states at the full marketing size, so a state proof is not a recolour done in a graphics editor. */
for (const [file, state] of [
  ["mark-full-240-revoked.png", "revoked"],
  ["mark-full-240-expired.png", "expired"],
]) {
  await sharp(Buffer.from(ticketSvg({ width: 240, state }))).png().toFile(join(OUT, file));
  written.push(join(OUT, file));
}

/** The icon tier: square tiles, teal, white print at 56%. Favicon + PassKit + avatar. */
for (const px of [87, 58, 29]) {
  await sharp(Buffer.from(tileSvg({ size: px }))).png().toFile(join(OUT, `mark-icon-${px}.png`));
  written.push(join(OUT, `mark-icon-${px}.png`));
}
for (const px of [16, 32, 48, 180, 512]) {
  await sharp(Buffer.from(tileSvg({ size: px }))).png().toFile(join(OUT, `favicon-${px}.png`));
  written.push(join(OUT, `favicon-${px}.png`));
}

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

const MONO = lockupHorizontal({ mono: true });
writeFileSync(join(OUT, "lockup-mono.svg"), MONO);
written.push(join(OUT, "lockup-mono.svg"));
await sharp(Buffer.from(MONO)).png().toFile(join(OUT, "lockup-mono.png"));

/* OG card, 1200 × 630 — teal rule, ticket left, the one line. No amber: this is the logo, not the site. */
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect x="0" y="0" width="1200" height="10" fill="${TEAL}"/>
  <g transform="translate(80 96)">${ticketGroup({ width: 180 })}</g>
  <text x="300" y="176" font-family="${SANS}" font-size="64" font-weight="700" letter-spacing="-1.3" fill="${INK}" stroke="${INK}" stroke-width="1.2">PayStage</text>
  <text x="80" y="330" font-family="${SANS}" font-size="56" font-weight="700" letter-spacing="-1.2" fill="${INK}" stroke="${INK}" stroke-width="1">Stop the payment before it&#8217;s signed.</text>
  <text x="80" y="392" font-family="${SANS}" font-size="28" font-weight="500" fill="${MUTED}">A read-only gate for x402 payments on Base.</text>
  <text x="80" y="560" font-family="${SANS}" font-size="24" font-weight="600" letter-spacing="2.4" fill="${DEEP}">PAYSTAGE.XYZ</text>
  <g transform="translate(940 470)">${ticketGroup({ width: 160 })}</g>
</svg>`;
writeFileSync(join(OUT, "og-1200x630.svg"), og);
await sharp(Buffer.from(og)).png().toFile(join(OUT, "og-1200x630.png"));

await contactSheet();
console.log(`brand-kit: wrote ${written.length} source SVG(s) + PNG exports to ${OUT}/`);
console.log(
  `brand-kit: mark = ticket ${MARK.width}×${MARK.height} (${MARK.ratio.toFixed(3)}:1), 4 scallops r${MARK.scallop.radius.toFixed(2)}, ` +
    `2 notches r${MARK.notch.radius.toFixed(2)}, print ${MARK.print.paths.length} Lucide paths at stroke ${MARK.print.stroke}/${MARK.print.grid}`,
);

/* ------------------------------------------------ contact sheet --------------------------------------------------- */

/**
 * One sheet showing the mark at the sizes it will actually be seen at (240, 142, 89, 64 px), the three states, and the
 * icon tiles on paper and on ink. A logo that only works at 240 is not a logo, and this is the only way to see that
 * before it ships.
 */
async function contactSheet() {
  const sizes = [240, 142, 89, 64];
  const tiles = [87, 58, 29, 16];
  const W = 1280;
  const H = 700;
  const composites = [];
  // The ink band, so the paper plates and the teal body are both seen against a dark field.
  const band = await sharp({ create: { width: W, height: 230, channels: 4, background: INK } }).png().toBuffer();
  composites.push({ input: band, left: 0, top: 250 });

  let x = 40;
  for (const px of sizes) {
    const png = await sharp(Buffer.from(ticketSvg({ width: px }))).png().toBuffer();
    composites.push({ input: png, left: x, top: 80 });
    composites.push({ input: png, left: x, top: 300 });
    x += px + 40;
  }

  // The three state inks at 142 px, on paper, in one row.
  x = 40;
  for (const state of ["active", "revoked", "expired"]) {
    const png = await sharp(Buffer.from(ticketSvg({ width: 142, state }))).png().toBuffer();
    composites.push({ input: png, left: x, top: 520 });
    x += 142 + 46;
  }

  // The icon tier, at the sizes it is used, on paper.
  x = 720;
  for (const px of tiles) {
    const png = await sharp(Buffer.from(tileSvg({ size: px }))).png().toBuffer();
    composites.push({ input: png, left: x, top: 540 });
    x += Math.max(px, 40) + 24;
  }

  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <text x="40" y="40" font-family="${SANS}" font-size="28" font-weight="700" fill="${INK}">the ticket — 356 × 208, four scallops, two mid notches, the Lucide print</text>
      <text x="40" y="232" font-family="${SANS}" font-size="17" fill="${MUTED}">top: on paper · bottom: on ink · full 240/142, reduced 89/64 — the print stroke thickens below 142</text>
      <text x="40" y="498" font-family="${SANS}" font-size="17" fill="${MUTED}">state lives in the print: white active · red revoked · grey expired (same ticket, same silhouette)</text>
      <text x="720" y="498" font-family="${SANS}" font-size="17" fill="${MUTED}">icon tier — favicon / PassKit / avatar</text>
      <text x="40" y="676" font-family="${SANS}" font-size="16" fill="#8A8F98">print: Lucide fingerprint-pattern (ISC) · ticket: ours · no amber in the mark</text>
    </svg>`,
  );
  composites.push({ input: label, left: 0, top: 0 });

  await sharp({ create: { width: W, height: H, channels: 4, background: PAPER } })
    .composite(composites)
    .png()
    .toFile(join(OUT, "sheet-ticket.png"));
}
