/**
 * The VouchGuard brand pack: the bytes a fork downloads, not a folder someone zipped by hand.
 *
 * One source of truth. Every SVG in the pack is drawn here from `scripts/lib/mark.mjs` and the
 * repository's `brand.json`; the PNG tier exports are the ones `scripts/brand-kit.mjs` renders from
 * the same module, embedded by `scripts/gen-brand-png-module.mjs` so the route can serve them from
 * a Worker where there is no filesystem and `sharp` cannot run. `scripts/check-brand-assets.mjs`
 * compares every embedded PNG with `brand/` and compares the zip's `brand.json` with the repo's, so
 * "generated at request time" cannot silently become "a stale copy".
 *
 * No dependency: `node:zlib` is not needed because the archive is stored (method 0), which the ZIP
 * format allows and every unzip tool reads. That also means no native module in the Worker.
 */

import { MARK, MARK_COLOURS, ticketGroup, ticketSvg, tileSvg } from "./mark.mjs";

/** The spec this pack follows. The mark changed five times in one night; a fork needs to know which one it got. */
export const PACK_VERSION_DATE = "2026-11-28";

/** The tier raster exports. The route embeds these bytes; the check proves they still match `brand/`. */
export const PACK_PNG_NAMES = Object.freeze([
  "mark-full-240.png",
  "mark-full-142.png",
  "mark-reduced-89.png",
  "mark-reduced-64.png",
  "mark-full-240-revoked.png",
  "mark-full-240-expired.png",
  "mark-icon-87.png",
  "mark-icon-58.png",
  "mark-icon-29.png",
]);

export const PACK_SVG_NAMES = Object.freeze([
  "mark.svg",
  "mark-revoked.svg",
  "mark-expired.svg",
  "mark-mono.svg",
  "mark-icon.svg",
  "lockup-vertical.svg",
  "lockup-horizontal.svg",
]);

const MIT_LICENCE = `MIT License

Copyright (c) 2026 PayStage

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/**
 * Lucide is ISC, not MIT. It travels as its own file so a fork that reads only LICENCE does not
 * silently drop the notice for the nine paths that are not ours.
 */
const ISC_LICENCE = `ISC License

Copyright (c) for portions of the work: Lucide Contributors (https://lucide.dev)

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`;

const esc = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const h = (width) => Math.round((width * MARK.height) / MARK.width);

/**
 * Vertical lockup: symbol above, wordmark beneath, wordmark pinned to the symbol's width.
 *
 * `textLength` is what makes any name fit: without it a long wordmark widens the lockup and the
 * symbol stops being the anchor. This is the same construction as `brand-kit.mjs`, but the wordmark
 * comes from `brand.json` instead of a constant, so the pack cannot ship another brand's name.
 *
 * @param {{ brand: { name: string, wordmark: string }, width?: number, markWidth?: number }} [options]
 */
export function lockupVerticalSvg({ brand, width = 900, markWidth = 560 } = {}) {
  const markW = Number(markWidth);
  const markH = h(markW);
  const pad = Math.round(markW * 0.1);
  const gap = Math.round(markH * 0.168);
  const wordSize = Math.round(markW * 0.17);
  const height = Math.round(pad + markH + gap + wordSize * 1.05 + pad);
  const cx = Number(width) / 2;
  const wordY = Math.round(pad + markH + gap + wordSize * 0.8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(brand.name)} vertical lockup">
  <rect width="${width}" height="${height}" fill="${MARK_COLOURS.paper}"/>
  ${ticketGroup({ x: (Number(width) - markW) / 2, y: pad, width: markW, strokeScale: 1, label: `${brand.name} ticket` })}
  <text x="${cx}" y="${wordY}" text-anchor="middle" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${wordSize}" font-weight="700" letter-spacing="${-wordSize * 0.02}" fill="${MARK_COLOURS.ink}"
        textLength="${markW}" lengthAdjust="spacingAndGlyphs">${esc(brand.wordmark)}</text>
</svg>`;
}

/**
 * Horizontal lockup: symbol left, wordmark right, gap = half the symbol's width.
 *
 * @param {{ brand: { name: string, wordmark: string }, width?: number, markWidth?: number }} [options]
 */
export function lockupHorizontalSvg({ brand, width = 1200, markWidth = 260 } = {}) {
  const markW = Number(markWidth);
  const markH = h(markW);
  const gap = Math.round(markW * 0.5);
  const wordSize = Math.round(markW * 0.46);
  const maxText = Number(width) - markW - gap - Math.round(Number(width) * 0.04);
  const naturalText = Math.round(String(brand.wordmark).length * wordSize * 0.58);
  const fit = naturalText > maxText ? ` textLength="${maxText}" lengthAdjust="spacingAndGlyphs"` : "";
  const blockW = markW + gap + Math.min(naturalText, maxText);
  const height = Math.round(Math.max(markH, wordSize * 1.3) + markW * 0.5);
  const x = Math.round((Number(width) - blockW) / 2);
  const markY = Math.round((height - markH) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(brand.name)} horizontal lockup">
  <rect width="${width}" height="${height}" fill="${MARK_COLOURS.paper}"/>
  ${ticketGroup({ x, y: markY, width: markW, strokeScale: 1, label: `${brand.name} ticket` })}
  <text x="${x + markW + gap}" y="${Math.round(height / 2 + wordSize * 0.36)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${wordSize}" font-weight="700" letter-spacing="${-wordSize * 0.02}" fill="${MARK_COLOURS.ink}"${fit}>${esc(brand.wordmark)}</text>
</svg>`;
}

/**
 * The SVG masters, by pack-relative name. Nothing here is read from disk.
 *
 * `mark.mjs` numbers its mask ids from a module counter, which is fine for a page rendered once but
 * would make every request for the same zip produce different bytes. The ids are rewritten to a
 * stable, per-pack sequence so the download is reproducible and two fetches compare equal.
 */
export function packSvgMasters(brand) {
  const raw = {
    "mark.svg": ticketSvg({ width: MARK.width, state: "active", label: `${brand.name} ticket` }),
    "mark-revoked.svg": ticketSvg({ width: MARK.width, state: "revoked", label: `${brand.name} ticket, revoked` }),
    "mark-expired.svg": ticketSvg({ width: MARK.width, state: "expired", label: `${brand.name} ticket, expired` }),
    "mark-mono.svg": ticketSvg({ width: MARK.width, mono: true, label: `${brand.name} ticket, one colour` }),
    "mark-icon.svg": tileSvg({ size: 87, label: brand.name }),
    "lockup-vertical.svg": lockupVerticalSvg({ brand }),
    "lockup-horizontal.svg": lockupHorizontalSvg({ brand }),
  };
  const stable = {};
  Object.entries(raw).forEach(([name, svg], index) => {
    stable[name] = svg.replace(/paystage-ticket-mask-\d+/g, `paystage-ticket-mask-pack-${index}`);
  });
  return stable;
}

const README = ({ brand, version }) => `${brand.name} brand pack — version ${version}

This pack is generated from the same module the live brand page renders from
(scripts/lib/mark.mjs) plus this repository's brand.json. It is not a folder of
pictures somebody curated by hand.

WHAT IS IN HERE

  svg/    the masters: the ticket (active, revoked, expired), the one-colour
          ticket, the square icon tile, and the vertical and horizontal lockups
  png/    the tier exports: 240 full, 142 full, 89/64 reduced, 29/58/87 tiles,
          and the revoked/expired proofs at 240
  brand.json   the file that names the brand
  VERSION      the spec date, repeated below
  LICENCE      MIT — the ticket, the lockups, the tile and the code
  LICENCE-LUCIDE  ISC — the print is Lucide's, not ours

VERSION

  Version — ${version}

The mark changed five times in one night. This string is the spec this pack
follows; if a newer pack exists, its README says a different date.

WHAT YOU MAY CHANGE

  - the name and the wordmark (brand.json)
  - the tint, which is the site accent and never enters the mark
  - the domain, the worker name, the copy
  - the certificate, and whose Apple account it belongs to

WHAT YOU MUST NOT CHANGE

  - the geometry: 356 x 208, body inset 5, radius 28, exactly four concave
    corner scallops at 0.085 H and two larger mid notches at 0.105 H
  - the print: Lucide fingerprint-pattern, all nine paths, 24-grid, stroke 2,
    58% of H. It is the only ink.
  - state in the print: white active, #B42318 revoked, #8A8F98 expired,
    paper knockout for one colour. The ticket stays one teal object.
  - the three tiers: full at 142 px and above, reduced 64-141 with a thickened
    print stroke, the square tile below 64. There is no fourth drawing.
  - no amber in the mark: gold belongs to the site, never the logo.
  - the honesty lines: no custody, no tap to pay, not a payment card.

WHERE THE MARK MAY NOT APPEAR

  Never beside Visa, Mastercard or Apple Pay. Never in a "pay with" row.
  Never on a checkout button. Never on a terminal decal. Never inside a
  payment-scheme lockup.

  This is not a style preference. Beside a card brand the mark reads as
  "accepted here", which is the exact confusion this product exists to
  prevent. The mark is a record of authority, not a payment method.

CLEAR SPACE

  Keep 25% of the mark's width free on every side. Nothing enters it: no
  text, no border, no edge crop, no other logo.

MINIMUM SIZES

  vertical lockup 90 px wide, horizontal lockup 110 px, full ticket 142 px,
  reduced ticket 64 px, tile 29 px. Below the floor use the simpler drawing,
  never a smaller copy of the detailed one.

LICENCES

  Everything except the print is MIT (see LICENCE). The print is Lucide
  fingerprint-pattern, ISC licensed (see LICENCE-LUCIDE). The ticket is ours;
  the print is Lucide's craft. A borrowed shape cannot be our trademark.

WHAT WE ARE NOT OFFERING

  This is a brand and a codebase, not a franchise. There is no certification,
  no partner programme and no approval step — and no licence fee. If you
  change the name, it is your brand; if you break the honesty lines, it is
  your reputation, not ours.
`;

/* ---------------------------------------------------------------- ZIP writer ------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time for 2026-11-28 00:00. A fixed stamp makes the archive reproducible. */
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 28;
const DOS_TIME = 0;

function u16(view, offset, value) {
  view.setUint16(offset, value, true);
}
function u32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TypeError(`brand-pack: entry data must be a string or Uint8Array, got ${typeof value}`);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Build a ZIP archive with stored entries. The format is deliberately minimal: local headers,
 * one central directory, one end record. No compression, so no `zlib` and no native module.
 */
export function buildZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("brand-pack: entries must be a non-empty array");
  const encoder = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = String(entry.name);
    if (name === "" || name.includes("\u0000")) throw new TypeError("brand-pack: entry names must be non-empty");
    const nameBytes = encoder.encode(name);
    const data = toBytes(entry.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0x0800);
    u16(lv, 8, 0);
    u16(lv, 10, DOS_TIME);
    u16(lv, 12, DOS_DATE);
    u32(lv, 14, crc);
    u32(lv, 18, data.length);
    u32(lv, 22, data.length);
    u16(lv, 26, nameBytes.length);
    u16(lv, 28, 0);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 10, 0);
    u16(cv, 12, DOS_TIME);
    u16(cv, 14, DOS_DATE);
    u32(cv, 16, crc);
    u32(cv, 20, data.length);
    u32(cv, 24, data.length);
    u16(cv, 28, nameBytes.length);
    u16(cv, 30, 0);
    u16(cv, 32, 0);
    u16(cv, 34, 0);
    u16(cv, 36, 0);
    u32(cv, 38, 0);
    u32(cv, 42, offset);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length;
  }

  const centralOffset = offset;
  const centralBytes = concatBytes(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralBytes.length);
  u32(ev, 16, centralOffset);
  u16(ev, 20, 0);

  return concatBytes([...locals, centralBytes, end]);
}

/**
 * Read a stored ZIP back. Used by the check and the test so the assertion is made against the
 * archive a browser downloads, not against the array we think we wrote.
 */
export function readStoreZip(bytes) {
  const buf = toBytes(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("brand-pack: not a ZIP archive (no end-of-central-directory record)");
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > buf.length) throw new Error("brand-pack: central directory runs past the archive");

  const decoder = new TextDecoder();
  const entries = new Map();
  let p = cdOffset;
  for (let index = 0; index < total; index += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("brand-pack: bad central directory header");
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLength));
    if (method !== 0) throw new Error(`brand-pack: ${name} is compressed; this reader only handles stored entries`);
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`brand-pack: ${name} has a bad local header`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buf.slice(start, start + size);
    if (crc32(data) !== crc) throw new Error(`brand-pack: ${name} does not match its CRC`);
    entries.set(name, data);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * The pack. `pngs` is the map produced by `scripts/gen-brand-png-module.mjs` (or read from
 * `brand/` by the check); every name is required, because a pack missing a tier is a pack that
 * silently teaches the wrong size.
 *
 * @param {{ brand: { name: string, wordmark: string, [key: string]: unknown }, pngs: Record<string, Uint8Array | import("node:buffer").Buffer>, versionDate?: string }} options
 * @returns {Uint8Array}
 */
export function buildBrandPack({ brand, pngs, versionDate = PACK_VERSION_DATE } = {}) {
  if (!brand || typeof brand !== "object") throw new TypeError("brand-pack: brand.json object is required");
  if (typeof brand.name !== "string" || brand.name.trim() === "") throw new TypeError("brand-pack: brand.name is required");
  if (typeof brand.wordmark !== "string" || brand.wordmark.trim() === "") {
    throw new TypeError("brand-pack: brand.wordmark is required");
  }
  if (!pngs || typeof pngs !== "object") throw new TypeError("brand-pack: the PNG export map is required");

  const entries = [];
  const add = (name, data) => entries.push({ name, data });

  add("README.txt", README({ brand, version: versionDate }));
  add("VERSION", `${versionDate}\n`);
  add("LICENCE", MIT_LICENCE);
  add("LICENCE-LUCIDE", ISC_LICENCE);
  add("brand.json", `${JSON.stringify(brand, null, 2)}\n`);

  for (const [name, svg] of Object.entries(packSvgMasters(brand))) add(`svg/${name}`, svg);

  for (const name of PACK_PNG_NAMES) {
    const data = pngs[name];
    if (!data) throw new Error(`brand-pack: missing PNG export ${name} — run \`npm run brand:rebuild\``);
    const bytes = toBytes(data);
    if (bytes.length === 0) throw new Error(`brand-pack: PNG export ${name} is 0 bytes`);
    add(`png/${name}`, bytes);
  }

  return buildZip(entries);
}
