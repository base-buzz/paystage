/**
 * The pass face, as one SVG layout function (#434).
 *
 * Everything visual about the Vouch pass comes from here: the Wallet strip, the logo, the icon, and the 2x
 * article mock. `render-pass-assets.mjs` rasterises it and the lander can inline the same string, so the hero a
 * reader sees and the asset we upload cannot drift into two drawings.
 *
 * **Data in, pixels out.** This decides nothing: the state, the limit, the expiry and the principal are passed in,
 * and `ACTIVE` / `REVOKED` is not inferred here — it comes from the endpoint that owns the mandate (#423). A layout
 * function that could decide a verdict would be a second evaluator, which is the one thing this project cannot
 * afford.
 *
 * No fonts are loaded and no external assets are referenced: text uses the generic families Apple's own passes
 * fall back to, so a render on a build machine and a render on a phone look the same.
 */

/**
 * One token file, two runtimes (#440).
 *
 * `apps/console/src/lib/pass-tokens.json` is read here **and** by the `/m/[serial]` page, so the palette, the poster
 * tints, the type scale and the pad ratio cannot be two transcriptions that happen to agree. It is JSON rather than
 * `.ts` because this file is plain ESM and cannot import TypeScript: a `.ts` token file would be readable by the page
 * and not by the renderer, which is exactly the review-matching this row exists to remove.
 */
import TOKENS from "../../apps/console/src/lib/pass-tokens.json" with { type: "json" };
import { MARK_COLOURS, ticketGroup, tileSvg } from "./mark.mjs";

/** The token object itself, exported so a test can prove both runtimes read the same values. */
export const PASS_TOKENS = TOKENS;

// Palette from docs/proposals/vouch-brand.md. Gold is the scarce signal — the V and the tick, never more than
// about a tenth of any surface — so it appears here exactly once.
const { ink: INK, paper: PAPER, deep: DEEP, gold: GOLD, muted: MUTED, red: RED } = TOKENS.palette;
const TYPE = TOKENS.type;
const SPACING = TOKENS.spacing;
const GEOMETRY = TOKENS.geometry;

/** Short, stable, and readable aloud when a camera will not scan. */
export function shortCode(serial) {
  const clean = String(serial ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `vch-${(clean.slice(-3) || "000").padStart(3, "0")}`;
}

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The abstract V geometry on the strip. Deliberately nothing literal: no card, no chip, no network arcs.
 * `revoked` desaturates it and swaps the accent for the refusal band, because the face must say so plainly.
 */
function stripArtwork(width, height, revoked, withMark = false) {
  const size = Math.round(height * 0.62);
  const accent = revoked ? "#6B7280" : DEEP;
  const band = revoked ? RED : "#1B4F8A";
  const v = height * 0.62;
  const x = width * 0.5;
  return `
    <defs>
      <linearGradient id="strip" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${accent}"/>
        <stop offset="1" stop-color="${INK}"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#strip)"/>
    ${withMark ? ticketMark({ x: x - size / 2, y: (height - size * 0.62) / 2, size, state: revoked ? "REVOKED" : "ACTIVE" }) : ""}
    <rect x="0" y="${height - Math.max(3, height * 0.05)}" width="${width}" height="${Math.max(3, height * 0.05)}" fill="${band}"/>
  `;
}

/**
 * @param {object} face
 * @param {number} face.width            rendered width in px; everything else scales from it
 * @param {"ACTIVE"|"REVOKED"|"EXPIRED"} face.state
 * @param {string} face.limit            e.g. "$0.50" — the per-payment ceiling
 * @param {string} [face.window]         e.g. "$20.00 per 24h" — the second ceiling **as a window, not a lifetime
 *                                       total**: the policy schema has `velocity.windows[]` with `window_seconds`,
 *                                       `max_amount`, `max_count` and `per_payee_max_amount`, and no lifetime
 *                                       allowance anywhere (checked 2026-11-25). A plate showing only the per-payment
 *                                       ceiling lets a reader believe that is the most that can be lost — false by an
 *                                       unbounded factor; calling a window a "total" errs worse, because it makes the
 *                                       mandate look safer than it is.
 * @param {string} face.expiry           e.g. "31 Jan 2027"
 * @param {string} face.principal        the entity the mandate is issued to, e.g. "Northwind Ltd"
 * @param {string} face.serial           e.g. "vch-7F3", stable and readable aloud
 * @param {string} [face.fundedFrom]     what pays for it, e.g. "test credits" — a budget, never a chain (#454)
 * @param {string} [face.brand]          the wordmark; a parameter because the name is a working one
 * @param {string} [face.vouchedBy]      the sibling line under the wordmark
 * @param {string} [face.qrCells]        a 2D array of 0/1 when a real QR is available; omitted = no code drawn
 */
/**
 * Per-teammate tint, deterministic from the teammate's name.
 *
 * All seven are AA with white text, and **gold is deliberately absent**: gold belongs to the pass face and the site,
 * and a teammate colour that could be mistaken for a state signal is worse than no colour at all. Deterministic so the
 * same teammate looks the same on every device and in every render — a colour that changes per run is decoration.
 */
export const POSTER_TINTS = TOKENS.posterTints;

export function tintFor(name) {
  const text = String(name ?? "");
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) >>> 0;
  return POSTER_TINTS[sum % POSTER_TINTS.length];
}

export function passFaceSvg(face) {
  const width = Number(face.width);
  if (!Number.isFinite(width) || width < 80) throw new TypeError("passFaceSvg: width must be a number >= 80");
  const revoked = face.state === "REVOKED";
  const expired = face.state === "EXPIRED";
  const dead = revoked || expired;

  /**
   * v3 (2026-11-26): the poster artwork carries the teammate's name, large, because the poster is an image and type
   * size there is ours to choose. The limit stays the primary *field* below, so `$2.00` is still where the eye lands.
   * The face no longer prints the serial: it is a support reference, not a human cue — it lives in the back fields
   * and as the QR's `altText` ("<teammate> · vch-7F3"), which is the one place a person reads it aloud.
   */
  const teammate = face.teammate ?? null;
  const tint = face.tint ?? tintFor(teammate?.name ?? "");
  const height = Math.round(width * GEOMETRY.aspect);
  const pad = Math.round(width * SPACING.pad);
  const posterH = Math.round(height * (teammate ? GEOMETRY.posterShareNamed : GEOMETRY.posterShareBare));
  const unit = width / 100;
  const f = (n) => Math.round(n * unit * 100) / 100;

  const limitY = posterH + height * 0.15;
  const limitStrike = dead
    ? `<line x1="${pad}" y1="${limitY - f(4.4)}" x2="${pad + f(38)}" y2="${limitY - f(4.4)}" stroke="${RED}" stroke-width="${f(0.9)}"/>`
    : "";

  const label = (x, y, text, size, colour = MUTED, weight = 600, spacing = "0.08em", anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${size}"
       font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}" fill="${colour}">${esc(text)}</text>`;

  const box = { x: pad, y: posterH + height * 0.375, size: width * 0.42, h: width * 0.22 };
  const boxRight = box.x + box.size + f(5);

  const verify = Array.isArray(face.qrCells) && face.qrCells.length > 0
    ? `<rect x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" fill="${PAPER}" stroke="${INK}" stroke-width="${f(0.3)}"/>` +
      face.qrCells
        .flatMap((row, ry) =>
          row.map((cell, cx) =>
            cell
              ? `<rect x="${box.x + (cx * box.size) / row.length + f(0.6)}" y="${box.y + (ry * box.size) / face.qrCells.length + f(0.6)}"
                        width="${box.size / row.length}" height="${box.size / face.qrCells.length}" fill="${INK}"/>`
              : "",
          ),
        )
        .join("")
    : `<rect x="${box.x}" y="${box.y}" width="${box.size}" height="${box.h}" fill="none" stroke="${dead ? "#DDD9CF" : "#CFC9BC"}" stroke-width="${f(0.3)}"/>
       ${label(box.x + f(2.6), box.y + f(5.4), "VERIFY", f(TYPE.verifyLabel), MUTED, 650, "0.14em")}
       ${label(box.x + f(2.6), box.y + f(11.2), "paystage.xyz/m/" + esc(String(face.serial ?? "").replace(/^vch-/, "")), f(TYPE.verifyUrl), INK, 600, "0.01em")}
       ${label(box.x + f(2.6), box.y + f(16.2), "no app, no account", f(TYPE.verifyNote), MUTED, 500, "0.02em")}`;

  const chipW = f(20);
  const chipH = f(6.2);
  const chip = `<rect x="${width - pad - chipW}" y="${pad - f(1.2)}" width="${chipW}" height="${chipH}" rx="${chipH / 2}"
        fill="${dead ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.92)"}"/>
    ${label(width - pad - chipW / 2, pad + f(TYPE.chip), face.state, f(TYPE.chip), dead ? "#FFFFFF" : tint, 700, "0.12em", "middle")}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${width}" height="${posterH}" fill="${dead ? MUTED : tint}"/>
  <rect x="0" y="${posterH - Math.max(3, posterH * 0.012)}" width="${width}" height="${Math.max(3, posterH * 0.012)}" fill="${dead ? RED : GOLD}"/>

  ${ticketMark({ x: pad, y: pad - f(1.2), size: f(8.4), state: dead ? (revoked ? "REVOKED" : "EXPIRED") : "ACTIVE" })}
  ${label(pad + f(10.4), pad + f(3.2), face.brand ?? "vouchguard", f(TYPE.brand), "#FFFFFF", 500, "0.01em")}
  ${label(pad + f(10.4), pad + f(6.2), teammate ? `via ${teammate.platform ?? teammate.name} · ${teammate.category ?? "agent"}` : (face.vouchedBy ?? "vouched by PayStage"), f(TYPE.subBrand), "rgba(255,255,255,0.72)", 500, "0.03em")}
  ${chip}

  ${teammate
    ? label(width / 2, posterH * 0.5 + f(11), teammate.name, f(TYPE.name), "#FFFFFF", 600, "-0.015em", "middle")
    : ""}
  ${teammate
    ? label(width / 2, posterH - f(5.5), "this teammate is authorised to spend within the caps below", f(TYPE.meta), "rgba(255,255,255,0.66)", 500, "0.02em", "middle")
    : ""}

  ${label(pad, posterH + height * 0.055, "UP TO", f(TYPE.label), MUTED, 650, "0.14em")}
  ${label(pad, limitY, face.limit, f(TYPE.value), dead ? MUTED : INK, 700, "-0.02em")}
  ${limitStrike}
  ${label(pad + f(0.6), limitY + f(5.6), face.window ? `each purchase · ${face.window}` : "each purchase", f(TYPE.caption), MUTED, 500, "0.02em")}

  ${label(pad, posterH + height * 0.265, "EXPIRES", f(TYPE.fieldLabel), MUTED, 650, "0.14em")}
  ${label(pad, posterH + height * 0.30, face.expiry, f(TYPE.field), INK, 600, "0.01em")}
  ${label(width * 0.42, posterH + height * 0.265, "PRINCIPAL", f(TYPE.fieldLabel), MUTED, 650, "0.14em")}
  ${label(width * 0.42, posterH + height * 0.30, face.principal, f(TYPE.field), INK, 600, "0.01em")}

  <rect x="${pad}" y="${posterH + height * 0.345}" width="${width - pad * 2}" height="${f(0.2)}" fill="${dead ? "#E3E0D8" : "#DDD9CF"}"/>

  ${verify}
  ${label(boxRight, box.y + f(4.2), "FUNDED BY", f(TYPE.meta), MUTED, 650, "0.14em")}
  ${label(boxRight, box.y + f(9), face.fundedFrom ?? "test credits", f(TYPE.metaValue), INK, 600, "0.02em")}
  ${label(boxRight, box.y + f(14), "ISSUED BY", f(TYPE.meta), MUTED, 650, "0.14em")}
  ${label(boxRight, box.y + f(18.8), "PayStage", f(TYPE.metaValue), INK, 600, "0.01em")}

  ${label(pad, height - pad * 0.55, "They scan to verify. You tap Manage.", f(TYPE.footer), dead ? RED : INK, 600, "0.01em")}
</svg>`;
}

/** The strip alone: the band Apple renders above the fields. Width and height are explicit because Apple fixes them. */
export function passStripSvg({ width, height, revoked = false }) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 40 || h < 20) throw new TypeError("passStripSvg: bad width/height");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${stripArtwork(w, h, revoked, true)}</svg>`;
}

const FONT_STACK = "Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif";

/** The wordmark, for `logo.png` (160×50 max in Wallet). The default is the PayStage site logo; the pass uses `VOUCH`. */
export function passLogoSvg({ width, height }) {
  /*
   * The Wallet logo: the **mark plus the wordmark**, in paper on transparent — never a filled block.
   *
   * It used to draw a solid `DEEP` rectangle with the word "PAYSTAGE" in paper. Two things were wrong with that, and a
   * phone found both at once: the rectangle is the *same* deep colour as the pass background, so on the device it
   * vanished and only a faint wordmark remained; and it was a wordmark rather than the mark, so the ticket was absent
   * from the one artefact a stranger actually sees. `check-pass-assets` now asserts both: the logo carries the mark's
   * geometry, and its ink contrasts with the pass `backgroundColor`.
   */
  const w = Number(width);
  const h = Number(height);
  const markSize = h * 0.92;
  const gap = h * 0.18;
  const text = "VOUCHGUARD";
  // Product name in the logo comes from the brand config, not a literal — a fork must not ship our name.
  const wordSize = Math.min(h * 0.46, (w - markSize - gap) / (text.length * 0.66));
  const wordX = markSize + gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${ticketMark({ x: 0, y: (h - markSize) / 2, size: markSize, state: "active", body: PAPER, print: DEEP })}
  <text x="${wordX}" y="${h / 2 + wordSize * 0.36}" font-family="${FONT_STACK}" font-size="${wordSize}"
        font-weight="700" letter-spacing="${wordSize * 0.06}" fill="${PAPER}">${esc(text)}</text>
</svg>`;
}

/**
 * The mark on the pass: the **ticket**, applied inverted.
 *
 * The geometry is in `scripts/lib/mark.mjs`, shared with the brand kit, so the pass, the verification page and the
 * marketing kit are one drawing. On the pass the ticket is painted as a **paper** body on the tinted poster (a teal
 * body on a teal tint would disappear), so the ink is the state colour: ink active, red revoked, the spec's grey
 * expired. The state still lives in the print, never in the silhouette — that is the settled spec, and it is what makes
 * the three pass marks one drawing with three inks.
 */
export function ticketMark({
  x = 0,
  y = 0,
  size = 100,
  state = "active",
  paper = PAPER,
  ink = INK,
  red = RED,
  body = null,
  print = null,
  strokeScale = 1,
} = {}) {
  const s = String(state).toUpperCase();
  const stateKey = s === "REVOKED" ? "revoked" : s === "EXPIRED" ? "expired" : "active";
  /**
   * Poster marks sit on paper, so they use the **paper** tones: the dark red and a mid grey read there, while the light on-body
   * tones would vanish (#487). One palette per surface, chosen by what the ink sits on rather than by state alone.
   */
  const printColour =
    print ?? (s === "REVOKED" ? red : s === "EXPIRED" ? MARK_COLOURS.printOnPaper.expired : ink);
  return ticketGroup({
    x,
    y,
    width: Number(size),
    body: body ?? paper,
    print: printColour,
    state: stateKey,
    strokeScale,
  });
}

/** The mark alone, for `icon.png` (29×29 in notifications): the square tile, no type. */
export function passIconSvg({ width, height }) {
  const s = Math.min(Number(width), Number(height));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${tileSvg({ size: s })}</svg>`;
}

/**
 * The iOS Face ID sheet, as a frame in the storyboard (#438).
 *
 * This is deliberately **not** our design: it is a system sheet, and the only thing we choose is *when* it appears.
 * The frame exists so a reader sees one biometric prompt and no form, which is the whole claim of the walkthrough.
 * A caption must say it is the system sheet; a mock that implied we drew it would be a claim about iOS.
 */
export function faceIdSheetSvg({ width = 750, prompt = "Approve “this job”?" } = {}) {
  const w = Number(width);
  const h = Math.round(w * 0.62);
  const pad = Math.round(w * 0.08);
  const sheetH = Math.round(h * 0.66);
  const y = h - sheetH;
  const f = (n) => Math.round((n * w) / 100 * 100) / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#0B0F19" opacity="0.55"/>
  <rect x="0" y="${y}" width="${w}" height="${sheetH}" rx="${f(3)}" fill="#F2F2F7"/>
  <rect x="${w / 2 - f(3)}" y="${y + f(1.4)}" width="${f(6)}" height="${f(0.8)}" rx="${f(0.4)}" fill="#C7C7CC"/>
  <text x="${w / 2}" y="${y + f(11)}" text-anchor="middle" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(4.6)}" font-weight="600" fill="#101322">Face ID</text>
  <text x="${w / 2}" y="${y + f(18)}" text-anchor="middle" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(3.6)}" font-weight="400" fill="#3C3C43">${esc(prompt)}</text>
  <circle cx="${w / 2}" cy="${y + f(19)}" r="${f(5.4)}" fill="none" stroke="#1A1F71" stroke-width="${f(0.6)}"/>
  <path d="M ${w / 2 - f(2.2)} ${y + f(19)} l ${f(1.8)} ${f(1.8)} l ${f(3.2)} ${-f(3.6)}" fill="none" stroke="#1A1F71"
        stroke-width="${f(0.7)}" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${pad}" y="${y + sheetH - f(15)}" width="${w - pad * 2}" height="${f(0.2)}" fill="#D1D1D6"/>
  <text x="${pad}" y="${y + sheetH - f(7)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(3.4)}" font-weight="400" fill="#0A84FF">Cancel</text>
  <text x="${w - pad}" y="${y + sheetH - f(7)}" text-anchor="end" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(3.4)}" font-weight="600" fill="#0A84FF">OK</text>
</svg>`;
}

/**
 * The mandate page in a browser frame (#438): one mandate, the fields, and the one button that ends it.
 *
 * It shows the *page* rather than the pass because that is the correction the storyboard exists to make: the pass
 * cannot change anything. Every field here is data in — the page renders state, it does not decide.
 */
export function mandatePageSvg({ width = 750, state = "ACTIVE", limit = "$2.00", window = "$20.00 per 24h", expiry = "31 Jan 2027", principal = "Northwind Ltd", payees = ["api.onesource.io", "tanod.dev"], refusals = 2, serial = "vch-7F3" } = {}) {
  const w = Number(width);
  const h = Math.round(w * 1.22);
  const f = (n) => Math.round((n * w) / 100 * 100) / 100;
  const pad = f(7);
  const revoked = state === "REVOKED";
  const row = (y, label, value, extra = "") => `
    <text x="${pad}" y="${y}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${f(2.8)}"
          font-weight="600" letter-spacing="0.12em" fill="${MUTED}">${esc(label)}</text>
    <text x="${pad}" y="${y + f(4.6)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${f(3.8)}"
          font-weight="600" fill="${INK}">${esc(value)}</text>${extra}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#EDEBE6"/>
  <rect x="0" y="0" width="${w}" height="${f(7)}" rx="${f(1.6)}" fill="#DAD7CF"/>
  <circle cx="${f(4)}" cy="${f(3.5)}" r="${f(0.9)}" fill="#C4C0B6"/>
  <circle cx="${f(7)}" cy="${f(3.5)}" r="${f(0.9)}" fill="#C4C0B6"/>
  <circle cx="${f(10)}" cy="${f(3.5)}" r="${f(0.9)}" fill="#C4C0B6"/>
  <text x="${w / 2}" y="${f(4.4)}" text-anchor="middle" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(2.6)}" fill="#6B6862">paystage.xyz/m/${esc(String(serial).replace(/^vch-/, ""))}</text>
  <rect x="${f(6)}" y="${f(11)}" width="${w - f(12)}" height="${h - f(18)}" rx="${f(2)}" fill="${PAPER}"/>

  <text x="${pad + f(3)}" y="${f(19)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(4.4)}" font-weight="700" fill="${INK}">This mandate</text>
  <text x="${pad + f(3)}" y="${f(23.6)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(2.9)}" fill="${MUTED}">${esc(serial)} · ${esc(principal)} · <tspan fill="${revoked ? RED : INK}" font-weight="600">${esc(state)}</tspan></text>

  ${row(f(33), "LIMIT PER PURCHASE", limit, `<rect x="${w - pad - f(26)}" y="${f(28.6)}" width="${f(23)}" height="${f(6.4)}" rx="${f(1.4)}" fill="none" stroke="#C9C4B8"/>
     <text x="${w - pad - f(24)}" y="${f(33)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${f(3)}" fill="${MUTED}">change…</text>`)}
  ${row(f(43), "WINDOW CEILING", window)}
  ${row(f(52), "EXPIRES", expiry)}
  <text x="${pad}" y="${f(62)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${f(2.8)}"
        font-weight="600" letter-spacing="0.12em" fill="${MUTED}">APPROVED PAYEES</text>
  ${payees.map((p, i) => `
    <text x="${pad}" y="${f(67 + i * 5)}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
          font-size="${f(3.4)}" fill="${INK}">${esc(p)}</text>
    <text x="${w - pad}" y="${f(67 + i * 5)}" text-anchor="end" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
          font-size="${f(3)}" fill="${MUTED}">remove</text>`).join("")}
  ${row(f(84), "REFUSALS THIS PERIOD", String(refusals))}
  <rect x="${pad}" y="${h - f(20)}" width="${w - pad * 2}" height="${f(7)}" rx="${f(1.6)}" fill="none" stroke="${RED}" stroke-width="${f(0.35)}"/>
  <text x="${w / 2}" y="${h - f(15.4)}" text-anchor="middle" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif"
        font-size="${f(3.2)}" font-weight="600" fill="${RED}">End this mandate</text>
</svg>`;
}

/**
 * Frame 8 (#438 follow-on): **four teammates, four passes, one principal.**
 *
 * The single face argues what a pass *is*; this argues what a household of them looks like — a different tint per
 * teammate, a different cap per job, the same ticket and the same "you tap Manage" line. Drawn from the same tokens as
 * the face so a reader cannot tell the two apart except by count.
 */
export function stackedTeammatesSvg({ width = 750, teammates } = {}) {
  const list = teammates ?? [
    { name: "Grok Bot", platform: "Grok", category: "research", limit: "$2.00", window: "$20.00 per 24h" },
    { name: "Claude Ops", platform: "Claude", category: "ops", limit: "$0.50", window: "$5.00 per 24h" },
    { name: "Code Agent", platform: "Cursor", category: "build", limit: "$1.00", window: "$10.00 per 24h" },
    { name: "Data Runner", platform: "Qwen", category: "data", limit: "$0.25", window: "$2.00 per 24h" },
  ];
  const w = Number(width);
  const cardH = Math.round(w * 0.30);
  const step = Math.round(cardH * 0.72);
  const footer = Math.round(w * 0.075);
  const h = step * (list.length - 1) + cardH + footer;
  const f = (n) => Math.round(((n * w) / 100) * 100) / 100;
  const pad = f(6);
  const cardW = w - pad * 2;
  /** Back to front, so the first teammate sits on top of the pile the way a hand of cards is held. */
  const cards = [...list]
    .reverse()
    .map((t, revIndex) => {
      const i = list.length - 1 - revIndex;
      const y = i * step + f(2);
      const tint = POSTER_TINTS[i % POSTER_TINTS.length];
      return `<g>
      <rect x="${pad}" y="${y}" width="${cardW}" height="${cardH}" rx="${f(3)}" fill="${tint}"/>
      <rect x="${pad}" y="${y}" width="${cardW}" height="${f(0.9)}" rx="${f(0.4)}" fill="${GOLD}"/>
      ${ticketMark({ x: pad + f(4.5), y: y + cardH - f(11.5) + f(7.5) * 0.19, size: f(7.5), state: "ACTIVE" })}
      ${labelAt(pad + f(14), y + cardH - f(6.6), t.name, f(5.2), "#FFFFFF", 600, "-0.01em")}
      ${labelAt(pad + f(14), y + cardH - f(2.6), `via ${t.platform} · ${t.category}`, f(2.6), "rgba(255,255,255,0.72)", 500, "0.03em")}
      ${labelAt(w - pad - f(4.5), y + cardH - f(6.6), t.limit, f(5.0), "#FFFFFF", 700, "-0.01em", "end")}
      ${labelAt(w - pad - f(4.5), y + cardH - f(2.6), t.window, f(2.6), "rgba(255,255,255,0.72)", 500, "0.02em", "end")}
    </g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
  ${cards}
  ${labelAt(pad, h - f(2.4), "one principal · four teammates · each cap set by hand, each revocable on its own", f(2.4), MUTED, 500, "0.01em")}
</svg>`;
}

/** A tiny label helper for the composed frames; the face builds its own inside `passFaceSvg`. */
function labelAt(x, y, text, size, colour = MUTED, weight = 600, spacing = "0.02em", anchor = "start") {
  return `<text x="${x}" y="${y}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${size}"
    font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}" fill="${colour}">${esc(text)}</text>`;
}

/**
 * Frame 9: **the setup screen — four presets, one tap.**
 *
 * The complaint every onboarding screen earns is "a blank form is homework". So the presets are jobs, not limits: the
 * human picks the job and the numbers arrive filled in, which is the only way a person sets a cap willingly.
 */
export function setupScreenSvg({ width = 750, presets } = {}) {
  const list = presets ?? [
    { title: "Research", line: "up to $2.00 each · $20 a day", tag: "reading · APIs" },
    { title: "Errands", line: "up to $0.50 each · $5 a day", tag: "small buys" },
    { title: "Build", line: "up to $1.00 each · $10 a day", tag: "CI · packages" },
    { title: "Custom…", line: "set the numbers yourself", tag: "blank form" },
  ];
  const w = Number(width);
  const rowH = Math.round(w * 0.14);
  const h = Math.round(rowH * list.length + w * 0.26);
  const f = (n) => Math.round(((n * w) / 100) * 100) / 100;
  const pad = f(7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
  ${labelAt(pad, f(9), "Give a teammate a job", f(5.6), INK, 700, "-0.01em")}
  ${labelAt(pad, f(14), "Pick the job. The numbers arrive filled in; change any of them.", f(2.7), MUTED, 500, "0.01em")}
  ${list
    .map((p, i) => {
      const y = f(20) + i * rowH;
      const tint = tintFor(p.title);
      return `<g>
        <rect x="${pad}" y="${y}" width="${w - pad * 2}" height="${rowH - f(2.5)}" rx="${f(2.4)}" fill="${i === list.length - 1 ? "none" : PAPER}" stroke="${i === list.length - 1 ? "#CFC9BC" : "none"}" stroke-width="${f(0.3)}" stroke-dasharray="${i === list.length - 1 ? `${f(1.4)} ${f(1.1)}` : "0"}"/>
        <rect x="${pad + f(3)}" y="${y + f(3)}" width="${f(7)}" height="${f(7)}" rx="${f(1.6)}" fill="${tint}"/>
        ${labelAt(pad + f(13), y + f(6.4), p.title, f(4.4), INK, 600, "-0.01em")}
        ${labelAt(pad + f(13), y + f(10.8), p.line, f(3.0), MUTED, 500, "0.01em")}
        ${labelAt(w - pad - f(3), y + f(6.4), p.tag, f(2.6), MUTED, 500, "0.01em", "end")}
      </g>`;
    })
    .join("")}
  ${labelAt(pad, h - f(3), "the human picks a job once; the agent drafts every later change", f(2.9), MUTED, 500, "0.01em")}
</svg>`;
}
