#!/usr/bin/env node
/**
 * The PayStage mark, rendered from the approved numbers — the print and the word.
 *
 * One generator, because the header, the favicon, the OG card and the avatar must not drift. The geometry is in
 * `scripts/lib/paystage-mark.mjs`; `scripts/check-brand-assets.mjs` opens what this writes and reads the ratio and
 * stroke back out of the files rather than trusting this comment.
 *
 * Output goes to `apps/console/public/`:
 *
 *   favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png (180), icon-512.png (512)   the square tile
 *   mark-lockup.svg (ink on paper), mark-lockup-inverse.svg (paper on ink)                the wide lockup
 *   og.png (1200 × 630)                                                                  lockup left, one line right
 *   wordmark.svg                                                                         the name alone
 *   avatar-512.png                                                                       the tile at 512
 *
 * Deterministic: no network, no clock, no new dependency. The wordmark's advance width is read from the Noto Sans
 * metrics that ship in the repo's Next install, so the ratio in the asset is a measurement, not a chosen number.
 *
 *   node scripts/paystage-mark.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAYSTAGE_MARK } from "./lib/paystage-mark.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/console/public");
const { ink: INK, paper: PAPER, word: WORD, glyph, lockup, tile, forbidden } = PAYSTAGE_MARK;

const SANS = "Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif";
const S = lockup.printHeight;
const PAD = Math.round(S * 0.12);
const GAP = S * lockup.gapShare;
const WORD_SIZE = lockup.wordSizeAtS200;

/** Round for output without exponent notation, so two runs write the same bytes. */
const n = (value) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

/* ------------------------------------------------ the font, and why it is read ----------------------------------- */

/**
 * The reference's 2.38 was **measured on the fallback face**, so this build measures too: read the advance widths
 * out of the TTF and sum them for the word. `textLength` then pins the rendering to that measured width, which is
 * what makes the ratio checkable in the built file and stable when a viewer substitutes a face.
 */
const FONT_CANDIDATES = [
  "apps/console/node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf",
  "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf",
];
const fontPath = FONT_CANDIDATES.map((path) => join(ROOT, path)).find((path) => existsSync(path));
if (!fontPath) {
  console.error(
    "paystage-mark: no Noto Sans metrics found — the wordmark width would be a guess. Run `npm install` (looked for " +
      `${FONT_CANDIDATES.join(", ")}).`,
  );
  process.exit(2);
}

/**
 * Minimal SFNT reader: head.unitsPerEm, hhea.numberOfHMetrics, hmtx advances, cmap format 4. Only the Latin
 * subset is needed for "paystage", and this is deliberately not a general font library.
 */
function readMetrics(file) {
  const buf = readFileSync(file);
  const u16 = (offset) => buf.readUInt16BE(offset);
  const u32 = (offset) => buf.readUInt32BE(offset);
  if (buf.toString("ascii", 0, 4) !== "\u0000\u0001\u0000\u0000" && buf.toString("ascii", 0, 4) !== "true") {
    throw new Error(`${file} is not a TrueType font`);
  }
  const tables = {};
  const count = u16(4);
  for (let i = 0; i < count; i += 1) {
    const entry = 12 + i * 16;
    tables[buf.toString("ascii", entry, entry + 4)] = { offset: u32(entry + 8) };
  }
  for (const required of ["head", "hhea", "hmtx", "cmap"]) {
    if (!tables[required]) throw new Error(`${file} has no ${required} table`);
  }
  const unitsPerEm = u16(tables.head.offset + 18);
  const numberOfHMetrics = u16(tables.hhea.offset + 34);

  const cmap = tables.cmap.offset;
  let subtable = null;
  for (let i = 0, records = u16(cmap + 2); i < records; i += 1) {
    const record = cmap + 4 + i * 8;
    if (u16(record) === 3 && u16(record + 2) === 1) subtable = cmap + u32(record + 4);
  }
  if (subtable === null) throw new Error(`${file} has no Windows Unicode cmap`);
  if (u16(subtable) !== 4) throw new Error(`${file} cmap is not format 4`);

  const segments = u16(subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const deltas = startCodes + segments * 2;
  const ranges = deltas + segments * 2;

  const glyphFor = (codePoint) => {
    for (let i = 0; i < segments; i += 1) {
      if (codePoint > u16(endCodes + i * 2)) continue;
      const start = u16(startCodes + i * 2);
      if (codePoint < start) return 0;
      const delta = u16(deltas + i * 2);
      const range = u16(ranges + i * 2);
      if (range === 0) return (codePoint + delta) & 0xffff;
      const glyph = u16(ranges + i * 2 + range + (codePoint - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };

  const advance = (character) => {
    const glyphId = glyphFor(character.codePointAt(0));
    if (glyphId === 0) throw new Error(`${file} has no glyph for ${JSON.stringify(character)}`);
    const index = Math.min(glyphId, numberOfHMetrics - 1);
    return u16(tables.hmtx.offset + index * 4) / unitsPerEm;
  };

  return {
    unitsPerEm,
    width: (text, size) => [...text].reduce((sum, character) => sum + advance(character), 0) * size,
  };
}

const font = readMetrics(fontPath);
const WORD_WIDTH = font.width(WORD, WORD_SIZE);
const RATIO = WORD_WIDTH / S;
if (RATIO > lockup.wordmarkCap) {
  console.error(
    `paystage-mark: the fallback sans sets "${WORD}" to ${WORD_WIDTH.toFixed(2)} px at ${WORD_SIZE} px ` +
      `(ratio ${RATIO.toFixed(3)}), over the ${lockup.wordmarkCap} cap. The cap is the contract, so this stops.`,
  );
  process.exit(1);
}

/**
 * Point fontconfig at the repo's Noto Sans, or every label and the wordmark are tofu/browser-default. Same device
 * `scripts/brand-kit.mjs` uses; the difference is this generator reads the metrics directly above.
 */
const fontConfigDir = join(tmpdir(), "paystage-mark-fonts");
mkdirSync(fontConfigDir, { recursive: true });
const fontConfig = join(fontConfigDir, "fonts.conf");
writeFileSync(
  fontConfig,
  `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${dirname(fontPath)}</dir>\n  <cachedir>${join(fontConfigDir, "cache")}</cachedir>\n</fontconfig>\n`,
);
process.env.FONTCONFIG_FILE = fontConfig;

const sharp = (await import("sharp")).default;

/* ------------------------------------------------ drawing -------------------------------------------------------- */

const glyphPaths = (stroke, { dataStroke = true } = {}) =>
  glyph.paths
    .map(
      (d, index) =>
        `<path${dataStroke ? ` data-glyph="${index + 1}"` : ""} d="${d}"/>`,
    )
    .join("\n      ");

/** The nine-path print on its 24-grid, scaled by `scale`. */
function printGroup({ scale, stroke, fill = "none", color = INK, height = null }) {
  return `<g data-print-set="${glyph.set}" data-print-grid="${glyph.grid}" data-print-stroke="${n(stroke)}"${
    height === null ? "" : ` data-print-height="${n(height)}"`
  } transform="scale(${n(scale)})" fill="${fill}" stroke="${color}" stroke-width="${n(stroke)}" stroke-linecap="round" stroke-linejoin="round">
      ${glyphPaths(stroke)}
    </g>`;
}

/**
 * The wordmark. `stroke` is a weight compensation for the regular-only face: the approved render is a bold sans and
 * this box has Noto Sans Regular. It is applied around the measured advance width, not instead of it.
 */
function wordmarkText({ x, y, size, color, textLength, strokeWidth, extra = "" }) {
  return `<text${extra} x="${n(x)}" y="${n(y)}" font-family="${SANS}" font-size="${n(size)}" font-weight="700" letter-spacing="0" fill="${color}" stroke="${color}" stroke-width="${n(strokeWidth)}" paint-order="stroke" textLength="${n(textLength)}" lengthAdjust="spacingAndGlyphs">${WORD}</text>`;
}

/** A wide lockup's inner drawing at height `s`, positioned at 0,0. */
function lockupBody({ s = S, color = INK, wordStroke = 4 }) {
  const pad = Math.round(s * 0.12);
  const gap = s * lockup.gapShare;
  const wordSize = (s / S) * WORD_SIZE;
  const wordWidth = (s / S) * WORD_WIDTH;
  const width = pad * 2 + s + gap + wordWidth;
  const height = s + pad * 2;
  const baseline = pad + s / 2 + wordSize * 0.32;
  return {
    width,
    height,
    body:
      `<g transform="translate(${n(pad)} ${n(pad)})">\n      ${printGroup({ scale: s / glyph.grid, stroke: glyph.lockupStroke, color, height: s })}\n    </g>\n    ` +
      wordmarkText({
        x: pad + s + gap,
        y: baseline,
        size: wordSize,
        color,
        textLength: wordWidth,
        strokeWidth: (wordStroke * wordSize) / WORD_SIZE,
        extra: ' data-wordmark="1"',
      }),
  };
}

function lockupSvg({ background = "none", color = INK }) {
  const { width, height, body } = lockupBody({ color });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-label="PayStage">
    ${background === "none" ? "" : `<rect width="${n(width)}" height="${n(height)}" fill="${background}"/>`}
    ${body}
  </svg>`;
}

/** The square tile: 100-grid, radius 22, print at 72%, ink with a paper glyph. */
function tileSvg(size, { background = INK, color = PAPER, radius = tile.radius } = {}) {
  const print = tile.grid * tile.printShare;
  const offset = (tile.grid - print) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${tile.grid} ${tile.grid}" role="img" aria-label="PayStage">
    <rect width="${tile.grid}" height="${tile.grid}" rx="${n(radius)}" fill="${background}"/>
    <g transform="translate(${n(offset)} ${n(offset)})">
      ${printGroup({ scale: print / glyph.grid, stroke: glyph.standaloneStroke, color })}
    </g>
  </svg>`;
}

function wordmarkSvg() {
  const width = WORD_WIDTH;
  const height = Math.round(WORD_SIZE * 1.3);
  const baseline = WORD_SIZE * 0.32 + WORD_SIZE * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${height}" viewBox="0 0 ${n(width)} ${height}" role="img" aria-label="PayStage">
    ${wordmarkText({ x: 0, y: baseline, size: WORD_SIZE, color: INK, textLength: width, strokeWidth: 4 })}
  </svg>`;
}

/** OG: paper, the lockup on the left, one line of copy on the right. */
function ogSvg() {
  const s = 140;
  const { width, height, body } = lockupBody({ s, color: INK, wordStroke: 4 });
  const x = 72;
  const y = Math.round((630 - height) / 2);
  const line = "Stop the payment before it's signed.";
  let size = 34;
  while (font.width(line, size) > 1160 - (x + width + 72) && size > 22) size -= 1;
  const textX = x + width + 72;
  const textY = 315 + size * 0.32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${PAPER}"/>
    <g transform="translate(${n(x)} ${n(y)})">${body}</g>
    <text x="${n(textX)}" y="${n(textY)}" font-family="${SANS}" font-size="${size}" font-weight="600" fill="${INK}">${line.replace(/'/g, "&#8217;")}</text>
  </svg>`;
}

/* ------------------------------------------------ ICO ------------------------------------------------------------ */

/**
 * Multi-size ICO with PNG payloads (supported by Vista and every browser that reads `.ico`). Written by hand so the
 * generator adds no dependency; the offsets are the whole format.
 */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]);
}

/* ------------------------------------------------ write ---------------------------------------------------------- */

mkdirSync(OUT, { recursive: true });
const written = [];
const write = (name, data) => {
  writeFileSync(join(OUT, name), data);
  written.push(name);
};
const renderPng = async (svg, name, size) => {
  const data = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  write(name, data);
  return data;
};

write("favicon.svg", tileSvg(32));
const icoPngs = [];
for (const size of [16, 32, 48]) {
  icoPngs.push({ size, data: await renderPng(tileSvg(size), `favicon-${size}.png`, size) });
}
// The per-size PNGs are intermediates for the ICO, not deliverables: remove them after packing.
for (const { size } of icoPngs) {
  const path = join(OUT, `favicon-${size}.png`);
  if (existsSync(path)) {
    rmSync(path);
    written.splice(written.indexOf(`favicon-${size}.png`), 1);
  }
}
write("favicon.ico", ico(icoPngs));
await renderPng(tileSvg(180), "apple-touch-icon.png", 180);
await renderPng(tileSvg(512), "icon-512.png", 512);
await renderPng(tileSvg(512), "avatar-512.png", 512);

write("mark-lockup.svg", lockupSvg({}));
write("mark-lockup-inverse.svg", lockupSvg({ color: PAPER }));
write("wordmark.svg", wordmarkSvg());
await renderPng(ogSvg(), "og.png", 1200);

/**
 * `assets/paystage-logo-400.png` predates this mark (a shield with a tick) and is unreferenced, but it is the
 * square logo a profile/avatar upload starts from. The P-and-dot sweep replaces it with the approved tile too, so
 * there is no second logo left in the tree to be picked up by accident.
 */
const legacyLogo = await sharp(Buffer.from(tileSvg(400))).png({ compressionLevel: 9 }).toBuffer();
mkdirSync(join(ROOT, "assets"), { recursive: true });
writeFileSync(join(ROOT, "assets/paystage-logo-400.png"), legacyLogo);

for (const hex of forbidden) {
  const inSvg = written
    .filter((name) => name.endsWith(".svg"))
    .some((name) => readFileSync(join(OUT, name), "utf8").toLowerCase().includes(hex.toLowerCase()));
  if (inSvg) {
    console.error(`paystage-mark: wrote ${hex} into a PayStage asset — that colour belongs to VouchGuard`);
    process.exit(1);
  }
}

console.log(`paystage-mark: wrote ${written.length} asset(s) to apps/console/public/`);
console.log(`  ${written.join(" · ")}`);
console.log("paystage-mark: replaced assets/paystage-logo-400.png with the tile (sweep of the old logo)");
console.log(
  `paystage-mark: print ${glyph.paths.length} Lucide paths on the ${glyph.grid}-grid · stroke ${n(glyph.standaloneStroke)} standalone / ${n(glyph.lockupStroke)} in the lockup · ` +
    `wordmark ${WORD_WIDTH.toFixed(2)} px at ${WORD_SIZE} px, S=${S}, ratio ${RATIO.toFixed(3)} (cap ${lockup.wordmarkCap})`,
);
