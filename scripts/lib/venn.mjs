/**
 * The venn: two 62 × 62 plates, radius 15, the second at x = 38 — **one value apart** (#460).
 *
 * Why this file exists rather than a copy in each renderer: the brand kit, the Wallet pass, the
 * verification page and the storyboard all draw the same mark, and the only thing that has stopped
 * them drifting is one source of numbers. The geometry below is the whole specification:
 *
 *   canvas 100 × 62
 *   plate A (left)   62 × 62, radius 15, solid, x = 0
 *   plate B (right)  62 × 62, radius 15, x = 38, 62% of plate A over the surface
 *   overlap          24 units = 24/62 = 38.7% of a plate
 *   lens             the intersection, and the only differentiated element
 *
 * **Why plate B is a second colour, not the same fill.** Two plates in one fill merge into one
 * silhouette — the defect this file previously shipped. Mastercard separates its shapes by colour,
 * not by geometry: red, then orange-yellow, and the overlap is a third value because the two blend.
 * So plate A is 100% of the ink and plate B is 62% of it over whatever the mark sits on. There is
 * still no outline and therefore still no small-size variant.
 *
 * **Why the blend is computed, not an `opacity` attribute.** An SVG `fill-opacity` makes the raster
 * depend on whatever is behind it when the SVG is composited: the same file on paper and on ink
 * would produce two different plate colours, and a PNG would bake in whichever surface the renderer
 * happened to use. This module computes the blended hex for an explicit `surface` instead, so the
 * output is deterministic and sampled contrast is a fact rather than a viewing condition.
 *
 * The surfaces that actually exist in this repo, and the value passed for each:
 *   - `paper`  #FFFFFF — brand marks, lockups, OG card, contact sheet top row, one-colour print;
 *   - `ink`    #101322 — the contact sheet bottom row (inverse plates);
 *   - `deep`   #1A1F71 — favicon/app tiles (inverse plates on the deep field);
 *   - the pass poster tints (`pass-tokens.json → posterTints`) and the Wallet strip's gradient
 *     midpoint — the pass draws inverse paper plates over those, and the caller passes the exact
 *     surface it paints (the strip uses the gradient's halfway colour, since the mark is centred).
 * A caller that omits `surface` gets `paper`, which is what the transparent brand PNGs are for.
 *
 * The lens is drawn as plate B clipped to plate A. That is the actual intersection of the two
 * rounded rectangles — not an approximation, and not a third shape drawn by hand.
 */

/** The numbers. Exported so a check can disagree with the drawing instead of trusting it. */
export const VENN = Object.freeze({
  width: 100,
  height: 62,
  plate: 62,
  radius: 15,
  plateA: 0,
  plateB: 38,
  overlap: 24,
  lensRatio: 24 / 62,
});

/** Plate B's share of plate A's value. 62% is the operator's number (#460), not a taste call. */
export const PLATE_B_ALPHA = 0.62;

/** The one-colour print equivalent: ink / ink 40% / paper knockout. */
export const MONO_PLATE_B_ALPHA = 0.4;

/** The named surfaces above, as values rather than themes. */
export const VENN_SURFACES = Object.freeze({
  paper: "#FFFFFF",
  ink: "#101322",
  deep: "#1A1F71",
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
  plate = "#1A1F71",
  lens = "#F7B600",
  surface = VENN_SURFACES.paper,
  secondOpacity = PLATE_B_ALPHA,
  plateB = null,
  id = "venn",
} = {}) {
  const plateColour = String(plate);
  const lensColour = String(lens);
  // Explicit second fill wins; otherwise the 62% (or mono 40%) blend is computed from the surface.
  const secondColour = plateB === null ? blendHex(plateColour, surface, secondOpacity) : String(plateB);
  // Ids must be unique when several marks share one SVG (the stacked-teammates frame).
  const clip = `${id}-a`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const k = width / VENN.width;
  return `<g transform="translate(${x} ${y}) scale(${k})">
  <defs>
    <clipPath id="${clip}">
      <rect x="${VENN.plateA}" y="0" width="${VENN.plate}" height="${VENN.plate}" rx="${VENN.radius}"/>
    </clipPath>
  </defs>
  <rect data-plate="A" x="${VENN.plateA}" y="0" width="${VENN.plate}" height="${VENN.plate}" rx="${VENN.radius}" fill="${plateColour}"/>
  <rect data-plate="B" data-surface="${String(surface)}" x="${VENN.plateB}" y="0" width="${VENN.plate}" height="${VENN.plate}" rx="${VENN.radius}" fill="${secondColour}"/>
  <g clip-path="url(#${clip})">
    <rect data-lens="1" x="${VENN.plateB}" y="0" width="${VENN.plate}" height="${VENN.plate}" rx="${VENN.radius}" fill="${lensColour}"/>
  </g>
</g>`;
}

/** The mark alone as a complete SVG, transparent behind it. Width is the controlling dimension. */
export function vennSvg({
  width = 100,
  plate = "#1A1F71",
  lens = "#F7B600",
  background = null,
  surface = background ?? VENN_SURFACES.paper,
  secondOpacity = PLATE_B_ALPHA,
  plateB = null,
  label = "Venn mark",
} = {}) {
  const w = Number(width);
  const h = Math.round((w * VENN.height) / VENN.width);
  const bg = background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
  ${bg}${vennGroup({ width: w, plate, lens, surface, secondOpacity, plateB })}
</svg>`;
}

/** State → lens colour. The only place the mapping lives. */
export const VENN_LENS = Object.freeze({
  ACTIVE: "#F7B600",
  REVOKED: "#B42318",
  EXPIRED: "#5B6472",
  MONO: "#FFFFFF",
});

/** Lens width in px at a given mark width: the 24-unit overlap as a fraction of the 100-unit canvas. */
export function lensPx(markWidth) {
  return (VENN.overlap / VENN.width) * Number(markWidth);
}
