/**
 * The mark, final: a **cinema ticket with the Lucide print**.
 *
 * Master grid **356 × 208** (1.71 : 1), taken from the operator's reference ticket. Everything below is a ratio of
 * that grid; a resize cannot silently change the idea, because no drawing file holds a number that is not here.
 *
 * The ticket is the coloured object; the **print is the ink**, and therefore the state:
 *
 *   active   #FFFFFF white
 *   revoked  #B42318 red
 *   expired  #8A8F98 grey
 *   one-colour  paper knockout on ink
 *
 * The silhouette is deliberately **not** the state any more — the settled spec moved state into the print. What the
 * silhouette carries is the shape: four concave corner scallops and two larger mid-edge notches, so the mark reads as a
 * ticket (a lace edge and a tear) rather than a rounded rectangle.
 *
 *   body        inset 5, corner radius 28
 *   4 scallops  r = 0.085 H = 17.68, one per corner, centred on the body's corner point, concave
 *   2 notches   r = 0.105 H = 21.84, one per end at y = H/2 — ~25% larger than a scallop so the tear wins at size
 *   print       Lucide `fingerprint-pattern`, all nine paths, 24-grid, stroke 2, height 0.58 H → scale k = 5.0267
 *
 * Three drawings, chosen by width, not by a mode switch at render time:
 *
 *   full     ≥ 142 px  everything
 *   reduced  64–141    corners + both mid notches, print stroke thickened to hold
 *   icon     < 64      square tile, radius 22% of the side, white print at 56% (favicon, PassKit 29/58/87, avatar)
 *
 * Attribution: the print is **Lucide's** craft (ISC, https://lucide.dev), the ticket is ours. The licence notice must
 * travel with any redistribution of the icon set, and the brand pack says plainly that a borrowed shape is not our
 * trademark.
 *
 * One source of numbers: `brand-kit.mjs`, `pass-face.mjs`, `render-loop.mjs` and every check import this file. If a
 * drawing disagrees with it, the drawing is wrong.
 */

const W = 356;
const H = 208;
const H2 = H / 2;

/**
 * Lucide `fingerprint-pattern`, v1.81.0, 24 × 24 grid, stroke 2.
 *
 * Copied verbatim from `lucide-react/dist/esm/icons/fingerprint-pattern.mjs` rather than approximated: the check
 * compares the path set against this array, so an invented "fingerprint-ish" line would fail instead of shipping.
 */
const LUCIDE_FINGERPRINT_PATTERN = Object.freeze([
  "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",
  "M14 13.12c0 2.38 0 6.38-1 8.88",
  "M17.29 21.02c.12-.6.43-2.3.5-3.02",
  "M2 12a10 10 0 0 1 18-6",
  "M2 16h.01",
  "M21.8 16c.2-2 .131-5.354 0-6",
  "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",
  "M8.65 22c.21-.66.45-1.32.57-2",
  "M9 6.8a6 6 0 0 1 9 5.2v2",
]);

/** The tier boundaries and the two tile ratios. A width is the only thing that picks a drawing. */
const TIERS = Object.freeze({
  full: Object.freeze({ minWidth: 142, strokeScale: 1 }),
  reduced: Object.freeze({ minWidth: 64, strokeScale: 1.35 }),
  icon: Object.freeze({ minWidth: 0, strokeScale: 1, radiusShare: 0.22, printShare: 0.56 }),
});

/** The numbers. Exported so a check can disagree with the drawing instead of trusting it. */
export const MARK = Object.freeze({
  width: W,
  height: H,
  ratio: W / H,
  inset: 5,
  radius: 28,
  scallop: Object.freeze({ count: 4, shareOfHeight: 0.085, radius: 0.085 * H }),
  notch: Object.freeze({ count: 2, shareOfHeight: 0.105, radius: 0.105 * H, y: H2 }),
  print: Object.freeze({
    set: "lucide/fingerprint-pattern",
    source: "Lucide (ISC) https://lucide.dev",
    grid: 24,
    stroke: 2,
    heightShare: 0.58,
    height: 0.58 * H,
    scale: (0.58 * H) / 24,
    paths: LUCIDE_FINGERPRINT_PATTERN,
  }),
  tiers: TIERS,
});

/** The mark's own colours. Teal ticket, white ink; state changes the ink, never the ticket. */
export const MARK_COLOURS = Object.freeze({
  body: "#1A5F7A",
  paper: "#FFFFFF",
  ink: "#101322",
  print: Object.freeze({ active: "#FFFFFF", revoked: "#B42318", expired: "#8A8F98" }),
  mono: Object.freeze({ body: "#101322", print: "#FFFFFF" }),
});

/** The exact inks a mark file is allowed to contain. Used by the check, not by the drawing. */
export const MARK_PALETTE = Object.freeze([
  MARK_COLOURS.body,
  ...Object.values(MARK_COLOURS.print),
  ...Object.values(MARK_COLOURS.mono),
]);

/** Which drawing a width asks for. `142` is full, `89` and `64` are reduced, anything below 64 is the tile. */
export function tierForWidth(width) {
  const w = Number(width);
  if (!(w > 0)) throw new TypeError(`mark: width must be a positive number, got ${width}`);
  if (w >= TIERS.full.minWidth) return "full";
  if (w >= TIERS.reduced.minWidth) return "reduced";
  return "icon";
}

/** The stroke multiplier for a ticket width: 1 for full, 1.35 for reduced. The icon never draws a ticket. */
export function strokeScaleForWidth(width) {
  return TIERS[tierForWidth(width)].strokeScale;
}

const round = (n) => Math.round(n * 1000) / 1000;

let maskCounter = 0;

/**
 * The cutting geometry — four scallops and two notches — as mask circles.
 *
 * The scallops are centred on the **body's** corner points (inset, inset), not the canvas corners: a 17.68 cut centred
 * on (0, 0) cannot reach a body inset by 5 (nearest point 18.67 away), while one centred on (5, 5) does (nearest point
 * 11.6 away). That distinction is the difference between a scalloped ticket and a rounded rectangle.
 */
function cutCircles() {
  const { inset, scallop, notch } = MARK;
  return [
    `<circle data-scallop="1" cx="${inset}" cy="${inset}" r="${round(scallop.radius)}" fill="#000000"/>`,
    `<circle data-scallop="2" cx="${W - inset}" cy="${inset}" r="${round(scallop.radius)}" fill="#000000"/>`,
    `<circle data-scallop="3" cx="${inset}" cy="${H - inset}" r="${round(scallop.radius)}" fill="#000000"/>`,
    `<circle data-scallop="4" cx="${W - inset}" cy="${H - inset}" r="${round(scallop.radius)}" fill="#000000"/>`,
    `<circle data-notch="left" cx="0" cy="${H2}" r="${round(notch.radius)}" fill="#000000"/>`,
    `<circle data-notch="right" cx="${W}" cy="${H2}" r="${round(notch.radius)}" fill="#000000"/>`,
  ].join("");
}

/** The nine Lucide paths, scaled onto the ticket's 24-grid. Stroke stays in 24-grid units. */
function printGroup(strokeScale, strokeColour) {
  const { grid, stroke, scale, paths } = MARK.print;
  const printW = grid * scale;
  const x = (W - printW) / 2;
  const y = (H - printW) / 2;
  return `<g data-print-set="${MARK.print.set}" data-print-grid="${grid}" data-print-stroke="${stroke}"
      data-print-stroke-scale="${round(strokeScale)}" data-print-scale="${round(scale)}"
      transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})"
      fill="none" stroke="${strokeColour}" stroke-width="${round(stroke * strokeScale)}" stroke-linecap="round" stroke-linejoin="round">
    ${paths.map((d) => `<path data-print="1" d="${d}"/>`).join("\n    ")}
  </g>`;
}

/**
 * The ticket as an SVG `<g>`, in the 356 × 208 master coordinate system.
 *
 * `width` is the rendered width in the parent's units; the group scales the master so one set of numbers reaches every
 * surface. `body` and `print` are colours, not themes, because the pass paints the ticket inverted on a tint and the
 * one-colour proof prints it as ink. `strokeScale` defaults to 1: a caller that knows its pixel width should pass
 * `strokeScaleForWidth(pixelWidth)` so the reduced tier thickens without a second drawing.
 */
export function ticketGroup({
  x = 0,
  y = 0,
  width = W,
  state = "active",
  body = MARK_COLOURS.body,
  print = null,
  mono = false,
  strokeScale = 1,
  label = "PayStage ticket",
} = {}) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) throw new TypeError(`mark: ticket width must be positive, got ${width}`);
  const key = String(state).toLowerCase();
  const printColour =
    print ?? (mono ? MARK_COLOURS.mono.print : (MARK_COLOURS.print[key] ?? MARK_COLOURS.print.active));
  const bodyColour = mono ? MARK_COLOURS.mono.body : body;
  if (!/^#[0-9a-fA-F]{6}$/.test(String(bodyColour)) || !/^#[0-9a-fA-F]{6}$/.test(String(printColour))) {
    throw new TypeError(`mark: body and print must be six-digit hex, got ${bodyColour} / ${printColour}`);
  }
  const k = w / W;
  const maskId = `paystage-ticket-mask-${maskCounter++}`;
  return `<g data-mark="paystage-ticket" data-state="${key}" transform="translate(${x} ${y}) scale(${round(k)})" aria-label="${String(label).replace(/"/g, "&quot;")}">
  <defs>
    <mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>
      ${cutCircles()}
    </mask>
  </defs>
  <rect data-body="1" x="${MARK.inset}" y="${MARK.inset}" width="${W - MARK.inset * 2}" height="${H - MARK.inset * 2}"
        rx="${MARK.radius}" fill="${bodyColour}" mask="url(#${maskId})"/>
  ${printGroup(Number(strokeScale), printColour)}
</g>`;
}

/**
 * The ticket alone as a complete SVG. Width is the controlling dimension; the height follows the master ratio.
 * The tier is inferred from `width`, so a 64 px export is the reduced drawing and a 240 px export is the full one.
 */
export function ticketSvg({
  width = W,
  state = "active",
  body = MARK_COLOURS.body,
  print = null,
  mono = false,
  strokeScale = strokeScaleForWidth(width),
  background = null,
  label = "PayStage ticket",
} = {}) {
  const w = Number(width);
  const h = Math.round((w * H) / W);
  const bg = background === null ? "" : `<rect width="${w}" height="${h}" fill="${background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${String(label).replace(/"/g, "&quot;")}" data-mark="paystage-ticket">
  ${bg}
  ${ticketGroup({ width: w, state, body, print, mono, strokeScale, label })}
</svg>`;
}

/**
 * The square tile — the icon tier. Teal tile, radius 22% of the side, the same nine-path print in white at 56% of the
 * tile. For favicons, PassKit's 29/58/87 and avatars: below 64 px the ticket is a sliver, so the tile takes over.
 */
export function tileSvg({
  size = 512,
  body = MARK_COLOURS.body,
  print = MARK_COLOURS.print.active,
  radiusShare = TIERS.icon.radiusShare,
  printShare = TIERS.icon.printShare,
  label = "PayStage",
} = {}) {
  const s = Number(size);
  if (!Number.isFinite(s) || s <= 0) throw new TypeError(`mark: tile size must be positive, got ${size}`);
  const { grid, stroke, paths } = MARK.print;
  const k = (printShare * s) / grid;
  const offset = (s - grid * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" role="img" aria-label="${String(label).replace(/"/g, "&quot;")}" data-mark="paystage-tile">
  <rect data-tile="1" width="${s}" height="${s}" rx="${round(s * radiusShare)}" fill="${body}"/>
  <g data-print-set="${MARK.print.set}" data-print-grid="${grid}" data-print-stroke="${stroke}" data-print-scale="${round(k)}"
     transform="translate(${round(offset)} ${round(offset)}) scale(${round(k)})"
     fill="none" stroke="${print}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    ${paths.map((d) => `<path data-print="1" d="${d}"/>`).join("\n    ")}
  </g>
</svg>`;
}

/** Hex → [r, g, b]. Kept here because the pass renderer blends against a surface it is painted on. */
export function parseHex(colour) {
  const hex = String(colour).trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new TypeError(`mark: not a six-digit hex colour: ${colour}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** [r, g, b] → lowercase `#rrggbb`. */
export function toHex(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Replace a share `alpha` of `base` with `surface`; used where a raster must be deterministic on a tint. */
export function blendHex(base, surface, alpha) {
  const a = Number(alpha);
  if (!(a >= 0 && a <= 1)) throw new TypeError(`mark: alpha must be in [0, 1], got ${alpha}`);
  const b = parseHex(base);
  const s = parseHex(surface);
  return toHex(b.map((v, i) => v * a + s[i] * (1 - a)));
}
