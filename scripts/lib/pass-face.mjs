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
function stripArtwork(width, height, revoked) {
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
    <path d="M ${x - v * 0.62} ${height * 0.2} L ${x} ${height * 0.2 + v} L ${x + v * 0.62} ${height * 0.2}"
          fill="none" stroke="${revoked ? "#9CA3AF" : GOLD}" stroke-width="${Math.max(2, height * 0.032)}"
          stroke-linecap="square" opacity="${revoked ? 0.45 : 0.9}"/>
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
export function passFaceSvg(face) {
  const width = Number(face.width);
  if (!Number.isFinite(width) || width < 80) throw new TypeError("passFaceSvg: width must be a number >= 80");
  const revoked = face.state === "REVOKED";
  const expired = face.state === "EXPIRED";
  const dead = revoked || expired;

  const height = Math.round(width * 1.38);
  const pad = Math.round(width * 0.064);
  const stripH = Math.round(height * 0.25);
  const unit = width / 100; // one percent of the width, so every size scales together
  const f = (n) => Math.round(n * unit * 100) / 100;

  const limitY = stripH + height * 0.155;
  const limitStrike = dead
    ? `<line x1="${pad}" y1="${limitY - f(4.4)}" x2="${pad + f(38)}" y2="${limitY - f(4.4)}" stroke="${RED}" stroke-width="${f(0.9)}"/>`
    : "";

  const label = (x, y, text, size, colour = MUTED, weight = 600, spacing = "0.08em", anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif" font-size="${size}"
       font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}" fill="${colour}">${esc(text)}</text>`;

  const box = { x: pad, y: stripH + height * 0.385, size: width * 0.42, h: width * 0.22 };
  const boxRight = box.x + box.size + f(5);
  /**
   * A QR is drawn **only** when real modules are supplied. A decorative pattern that looks scannable but is not is a
   * claim the image cannot keep, and this asset goes into an article that argues exactly against that. Without
   * modules the same box carries the verification URL, which is honest, legible at dock size, and says what the QR
   * will say when #423 exists.
   */
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${PAPER}"/>
  ${stripArtwork(width, stripH, revoked)}

  ${label(pad, pad + f(3.6), face.brand ?? "vouchguard", f(4.0), dead ? "#C7CDD6" : "#FFFFFF", 500, "0.01em")}
  ${label(pad, pad + f(6.6), face.vouchedBy ?? "vouched by PayStage", f(2.4), dead ? "#8C93A3" : "#B9BFD6", 500, "0.04em")}
  ${label(width - pad, pad + f(3.4), shortCode(face.serial), f(3.6), dead ? "#C7CDD6" : "#DCE7F5", 600, "0.08em", "end")}

  ${label(pad, stripH + height * 0.062, "UP TO", f(3.8), MUTED, 650, "0.14em")}
  ${label(pad, limitY, face.limit, f(15), dead ? MUTED : INK, 700, "-0.02em")}
  ${limitStrike}
  ${label(pad + f(0.6), limitY + f(5.6), face.window ? `each purchase · ${face.window}` : "each purchase", f(3.6), MUTED, 500, "0.02em")}

  ${label(pad, stripH + height * 0.275, "EXPIRES", f(3.0), MUTED, 650, "0.14em")}
  ${label(pad, stripH + height * 0.31, face.expiry, f(4.2), INK, 600, "0.01em")}
  ${label(width * 0.42, stripH + height * 0.275, "PRINCIPAL", f(3.0), MUTED, 650, "0.14em")}
  ${label(width * 0.42, stripH + height * 0.31, face.principal, f(4.2), INK, 600, "0.01em")}

  <rect x="${pad}" y="${stripH + height * 0.355}" width="${width - pad * 2}" height="${f(0.2)}" fill="${dead ? "#E3E0D8" : "#DDD9CF"}"/>

  ${verify}
  ${label(boxRight, box.y + f(4.2), "STATE", f(2.6), MUTED, 650, "0.14em")}
  ${label(boxRight, box.y + f(9.6), face.state, f(4.0), dead ? RED : INK, 700, "0.02em")}
  ${label(boxRight, box.y + f(14.6), "NETWORK", f(2.6), MUTED, 650, "0.14em")}
  ${label(boxRight, box.y + f(20), face.network ?? "Base", f(4.0), INK, 600, "0.02em")}
  ${label(boxRight, box.y + f(25), "ISSUER", f(2.6), MUTED, 650, "0.14em")}
  ${label(boxRight, box.y + f(30.4), "paystage.xyz", f(3.8), INK, 600, "0.01em")}

  ${label(pad, height - pad * 0.7, "Scan to verify · the face is not authoritative, the QR is", f(2.9), MUTED, 500, "0.01em")}
</svg>`;
}

/** The strip alone: the band Apple renders above the fields. Width and height are explicit because Apple fixes them. */
export function passStripSvg({ width, height, revoked = false }) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 40 || h < 20) throw new TypeError("passStripSvg: bad width/height");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${stripArtwork(w, h, revoked)}</svg>`;
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

/** The mark alone, for `icon.png` (29×29 in notifications): the V, no type. */
export function passIconSvg({ width, height, revoked = false }) {
  const w = Number(width);
  const h = Number(height);
  const stroke = Math.max(1.2, h * 0.11);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="${h * 0.22}" fill="${revoked ? "#6B7280" : DEEP}"/>
  <path d="M ${w * 0.28} ${h * 0.3} L ${w * 0.5} ${h * 0.72} L ${w * 0.72} ${h * 0.3}" fill="none"
        stroke="${revoked ? "#D1D5DB" : "#8FB6E8"}" stroke-width="${stroke}" stroke-linecap="square"/>
</svg>`;
}
