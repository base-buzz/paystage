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

// Palette from docs/proposals/vouch-brand.md. Gold is the scarce signal — the V and the tick, never more than
// about a tenth of any surface — so it appears here exactly once.
const INK = "#101322";
const PAPER = "#FFFFFF";
const DEEP = "#1A1F71";
const GOLD = "#F7B600";
const MUTED = "#5B6472";
const RED = "#B42318";

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
    ${withMark ? sealMark({ x: x - size / 2, y: (height - size) / 2, size, state: revoked ? "REVOKED" : "ACTIVE", paper: "#0E1B3A" }) : ""}
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
 * @param {string} [face.network]        e.g. "Base"
 * @param {string} [face.brand]          the wordmark; a parameter because the name is a working one
 * @param {string} [face.vouchedBy]      the sibling line under the wordmark
 * @param {string} [face.qrCells]        a 2D array of 0/1 when a real QR is available; omitted = no code drawn
 */
/**
 * Per-teammate tint, deterministic from the teammate's name.
 *
 * All seven are AA with white text, and **gold is deliberately absent**: gold belongs to the seal and the state, and a
 * teammate colour that could be mistaken for a state signal is worse than no colour at all. Deterministic so the same
 * teammate looks the same on every device and in every render — a colour that changes per run is decoration.
 */
export const POSTER_TINTS = ["#1A1F71", "#0F5257", "#4338CA", "#6B1D5E", "#14532D", "#334155", "#312E81"];

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
  const height = Math.round(width * 1.38);
  const pad = Math.round(width * 0.064);
  const posterH = Math.round(height * (teammate ? 0.34 : 0.25));
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
       ${label(box.x + f(2.6), box.y + f(5.4), "VERIFY", f(2.8), MUTED, 650, "0.14em")}
       ${label(box.x + f(2.6), box.y + f(11.2), "paystage.xyz/m/" + esc(String(face.serial ?? "").replace(/^vch-/, "")), f(3.2), INK, 600, "0.01em")}
       ${label(box.x + f(2.6), box.y + f(16.2), "no app, no account", f(2.8), MUTED, 500, "0.02em")}`;

  const chipW = f(20);
  const chipH = f(6.2);
  const chip = `<rect x="${width - pad - chipW}" y="${pad - f(1.2)}" width="${chipW}" height="${chipH}" rx="${chipH / 2}"
        fill="${dead ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.92)"}"/>
    ${label(width - pad - chipW / 2, pad + f(2.9), face.state, f(2.9), dead ? "#FFFFFF" : tint, 700, "0.12em", "middle")}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${width}" height="${posterH}" fill="${dead ? "#5B6472" : tint}"/>
  <rect x="0" y="${posterH - Math.max(3, posterH * 0.012)}" width="${width}" height="${Math.max(3, posterH * 0.012)}" fill="${dead ? RED : GOLD}"/>

  ${sealMark({ x: pad, y: pad - f(1.2), size: f(8.4), state: dead ? (revoked ? "REVOKED" : "EXPIRED") : "ACTIVE", paper: dead ? "#5B6472" : tint })}
  ${label(pad + f(10.4), pad + f(3.2), face.brand ?? "vouchguard", f(3.8), "#FFFFFF", 500, "0.01em")}
  ${label(pad + f(10.4), pad + f(6.2), teammate ? `via ${teammate.platform ?? teammate.name} · ${teammate.category ?? "agent"}` : (face.vouchedBy ?? "vouched by PayStage"), f(2.4), "rgba(255,255,255,0.72)", 500, "0.03em")}
  ${chip}

  ${teammate
    ? label(width / 2, posterH * 0.5 + f(11), teammate.name, f(20), "#FFFFFF", 600, "-0.015em", "middle")
    : ""}
  ${teammate
    ? label(width / 2, posterH - f(5.5), "this teammate is authorised to spend within the caps below", f(2.6), "rgba(255,255,255,0.66)", 500, "0.02em", "middle")
    : ""}

  ${label(pad, posterH + height * 0.055, "UP TO", f(3.8), MUTED, 650, "0.14em")}
  ${label(pad, limitY, face.limit, f(15), dead ? MUTED : INK, 700, "-0.02em")}
  ${limitStrike}
  ${label(pad + f(0.6), limitY + f(5.6), face.window ? `each purchase · ${face.window}` : "each purchase", f(3.6), MUTED, 500, "0.02em")}

  ${label(pad, posterH + height * 0.265, "EXPIRES", f(3.0), MUTED, 650, "0.14em")}
  ${label(pad, posterH + height * 0.30, face.expiry, f(4.2), INK, 600, "0.01em")}
  ${label(width * 0.42, posterH + height * 0.265, "PRINCIPAL", f(3.0), MUTED, 650, "0.14em")}
  ${label(width * 0.42, posterH + height * 0.30, face.principal, f(4.2), INK, 600, "0.01em")}

  <rect x="${pad}" y="${posterH + height * 0.345}" width="${width - pad * 2}" height="${f(0.2)}" fill="${dead ? "#E3E0D8" : "#DDD9CF"}"/>

  ${verify}
  ${label(boxRight, box.y + f(4.2), "NETWORK", f(2.6), MUTED, 650, "0.14em")}
  ${label(boxRight, box.y + f(9), face.network ?? "Base", f(3.8), INK, 600, "0.02em")}
  ${label(boxRight, box.y + f(14), "ISSUED BY", f(2.6), MUTED, 650, "0.14em")}
  ${label(boxRight, box.y + f(18.8), "PayStage", f(3.8), INK, 600, "0.01em")}

  ${label(pad, height - pad * 0.55, "They scan to verify. You tap Manage.", f(3.2), dead ? RED : INK, 600, "0.01em")}
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

/** The wordmark, for `logo.png` (160×50 max in Wallet). */
export function passLogoSvg({ width, height }) {
  const w = Number(width);
  const h = Number(height);
  const size = Math.min(h * 0.55, w * 0.16);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${DEEP}"/>
  <text x="${w / 2}" y="${h / 2 + size * 0.35}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${size}"
        font-weight="700" letter-spacing="${size * 0.14}" fill="#F4F1EA">PAYSTAGE</text>
</svg>`;
}

/**
 * The mark: a keyway seal, drawn to the numbers in `docs/proposals/vouch-mark-seal.md`.
 *
 * Replaces the letter V, for two reasons that colour could not fix: a V is a **letter**, and it reads as a
 * **checkmark** — a judgement, which is the seller's job and not ours. A keyway says *authority* and carries the
 * state in its slot, so a revoked pass says so in greyscale, without a word:
 *
 *   ACTIVE    slot cut from the left edge, stopping inside the plate  — key in, sealed
 *   EXPIRING  the same, plus a hairline notch near the slot's end     — being disturbed
 *   EXPIRED   slot filled, plate desaturated                          — empty lock
 *   REVOKED   slot runs all the way through, red hairline             — seal broken
 *
 * Geometry is on the spec's 100-unit grid and scales to any size. Four states, one function, because a mark that
 * needs a second drawing per state is four marks that will drift.
 */
export function sealMark({ x = 0, y = 0, size = 100, state = "ACTIVE", paper = PAPER, gold = GOLD, ink = INK, red = RED, compact = false } = {}) {
  /**
   * `compact` exists because the spec's own legibility check fails at 29 px: a 16-unit slot is 4.6 px there, and the
   * check asks for ≥ 5. At icon sizes the slot is widened to 20 units (5.8 px at 29) and the ring inset by 2 so the
   * slot still stops inside the plate. The full-size mark keeps the spec's exact geometry.
   */
  const slotH = compact ? 20 : 16;
  const slotY = 50 - slotH / 2;
  const ringInset = compact ? 12 : 10;
  const k = size / 100;
  const g = (n) => Math.round(n * k * 1000) / 1000;
  const s = String(state).toUpperCase();
  const revoked = s === "REVOKED";
  const expired = s === "EXPIRED";
  const ringColour = expired ? "rgba(16,19,34,0.4)" : revoked ? "#9CA3AF" : gold;
  const plate = expired ? "rgba(16,19,34,0.12)" : "none";
  const slotFill = expired ? "#E5E3DE" : paper;
  const slotW = revoked ? 100 : 46;
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <rect x="0" y="0" width="100" height="100" rx="16" fill="${plate}"/>
    <rect x="${ringInset}" y="${ringInset}" width="${100 - ringInset * 2}" height="${100 - ringInset * 2}" rx="8" fill="none" stroke="${ringColour}" stroke-width="4"/>
    <rect x="0" y="${slotY}" width="${slotW}" height="${slotH}" rx="${slotH / 2}" fill="${slotFill}"/>
    ${s === "EXPIRING" ? `<rect x="36" y="26" width="8" height="8" rx="4" fill="${gold}"/>` : ""}
    ${revoked ? `<line x1="0" y1="${slotY}" x2="100" y2="${slotY}" stroke="${red}" stroke-width="4"/><line x1="0" y1="${slotY + slotH}" x2="100" y2="${slotY + slotH}" stroke="${red}" stroke-width="4"/>` : ""}
  </g>`;
}

/** The mark alone, for `icon.png` (29×29 in notifications): the V, no type. */
export function passIconSvg({ width, height, revoked = false }) {
  const w = Number(width);
  const h = Number(height);
  const stroke = Math.max(1.2, h * 0.11);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="${h * 0.22}" fill="${revoked ? "#6B7280" : DEEP}"/>
  ${sealMark({ x: w * 0.18, y: h * 0.18, size: w * 0.64, state: revoked ? "REVOKED" : "ACTIVE", paper: DEEP, compact: true })}
</svg>`;
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
