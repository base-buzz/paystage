/**
 * The mark, **final**: the narrow-lens construction on an H = 100 grid, graphite palette.
 *
 * Two rounded plates — one ink, one slate — and a **gold lens that is a shape of its own**: a path with cusps at the top
 * and bottom edges, overrunning the geometric overlap by **1.375×** (62 against 45.1). That overrun is the idea. A lens
 * drawn as the boolean intersection of the plates reads as a bar or a battery, and two earlier attempts shipped exactly
 * that; the check asserts this ratio from the source so it cannot drift back.
 *
 * Everything is a ratio of the height, so the kit rebuilds at any size:
 *
 *   canvas    177.9 × 100          1.779 H
 *   plate A   x 0,      w 114.4, rx 31.4     1.144 H · rx 0.314 H
 *   plate B   x 69.3,   w 108.5, rx 31.4     0.693 H · 1.085 H
 *   overlap   45.1                  0.451 H
 *   lens      x 61 → 123, cx 92, full height 0.62 H · cx 0.92 H
 *
 * Palette: graphite, not bank-blue — it keeps the gold dominant and reads least like a card scheme. Plate A `#0B1020`,
 * plate B `#45506B`, lens `#F5CC00`. On the dark poster the plates invert to `#FAFAFA` / `#FFFFFF` over `#14205A`.
 * The lens colour carries state: gold active · red revoked · grey expired · paper knockout for one-colour.
 *
 * The lens is a **path, never a clip**: a clip is a boolean, and a boolean cannot overrun the overlap.
 */

/** The numbers. Exported so a check can disagree with the drawing instead of trusting it. */
export const VENN = Object.freeze({
  width: 177.9,
  height: 100,
  plateAX: 0,
  plateAWidth: 114.4,
  plateBX: 69.3,
  plateBWidth: 108.5,
  radius: 31.4,
  overlap: 45.1,
  lensWidth: 62,
  lensCentre: 92,
  lensToOverlap: 62 / 45.1,
  /** the operator's path, on the H = 100 grid: cusps at y = 0 and y = 100, control points ±0.62·w at 18%/82% */
  lensPath: "M92 0C130.4 18 130.4 82 92 100C53.6 82 53.6 18 92 0Z",
});

/** The named surfaces above, as values rather than themes. */
export const VENN_SURFACES = Object.freeze({
  paper: "#FFFFFF",
  ink: "#101322",
});

/**
 * The mark's own three values. Not page tints: the operator's construction separates the plates by saturated colour, and
 * a mark that borrows a page tint changes whenever the page does.
 */
export const VENN_INK = Object.freeze({
  plateA: "#0B1020",
  plateB: "#45506B",
  lens: "#F5CC00",
});

/** On the dark poster the plates invert, and the lens stays gold. */
export const VENN_INVERSE = Object.freeze({
  plateA: "#FAFAFA",
  plateB: "#FFFFFF",
  lens: "#F5CC00",
  field: "#14205A",
});

/** One-colour print: ink and a mid grey, lens knocked out to paper. */
export const VENN_MONO = Object.freeze({
  plateA: "#101322",
  plateB: "#6B7280",
  lens: "#FFFFFF",
});

/** Hex → [r, g, b]. Accepts `#RGB` and `#RRGGBB`; anything else is a programming error, not a colour. */
export function parseHex(colour) {
  const hex = String(colour).trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new TypeError(`venn: not a six-digit hex colour: ${colour}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** [r, g, b] → lowercase `#rrggbb`. */
export function toHex(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Replace a share `alpha` of `base` with `surface` — i.e. the colour of `base` at `alpha` over
 * `surface`, with the result made opaque. This is the whole #460 rule in one function.
 */
export function blendHex(base, surface, alpha) {
  const a = Number(alpha);
  if (!(a >= 0 && a <= 1)) throw new TypeError(`venn: alpha must be in [0, 1], got ${alpha}`);
  const b = parseHex(base);
  const s = parseHex(surface);
  return toHex(b.map((v, i) => v * a + s[i] * (1 - a)));
}

/**
 * The mark as an SVG `<g>`, in the 100 × 62 local coordinate system.
 *
 * `plate` is plate A's colour. Plate B is `plateB` if given, otherwise `plate` at `secondOpacity`
 * over `surface`. `lens` is a colour, not a theme, because the pass uses an inverse application on
 * the tinted poster and the one-colour proof uses ink plates with a paper lens.
 */
export function vennGroup({
  x = 0,
  y = 0,
  width = VENN.width,
  plate = VENN_INK.plateA,
  plateB = VENN_INK.plateB,
  lens = VENN_INK.lens,
  surface = VENN_SURFACES.paper,
} = {}) {
  const k = Number(width) / VENN.width;
  return `<g transform="translate(${x} ${y}) scale(${k})">
  <rect data-plate="B" data-surface="${String(surface)}" x="${VENN.plateBX}" y="0" width="${VENN.plateBWidth}" height="${VENN.height}" rx="${VENN.radius}" fill="${plateB}"/>
  <rect data-plate="A" x="${VENN.plateAX}" y="0" width="${VENN.plateAWidth}" height="${VENN.height}" rx="${VENN.radius}" fill="${plate}"/>
  <path data-lens="1" data-role="lens" d="${VENN.lensPath}" fill="${lens}"/>
</g>`;
}

/**
 * The mark alone as a complete SVG. Width is the controlling dimension; the height follows the master's ratio.
 */
/** The mark alone as a complete SVG, transparent behind it. Width is the controlling dimension. */
export function vennSvg({
  width = 272,
  plate = VENN_INK.plateA,
  plateB = VENN_INK.plateB,
  lens = VENN_INK.lens,
  background = null,
  surface = background ?? VENN_SURFACES.paper,
  label = "Venn mark",
} = {}) {
  const w = Number(width);
  const h = Math.round((w * VENN.height) / VENN.width);
  const bg = background === null ? "" : `<rect width="${w}" height="${h}" fill="${background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${VENN.width} ${VENN.height}" role="img" aria-label="${label}">
  ${bg}
  ${vennGroup({ width: VENN.width, plate, plateB, lens, surface })}
</svg>`;
}

export function lensPx(markWidth) {
  return (VENN.overlap / VENN.width) * Number(markWidth);
}
