/**
 * The venn: two **solid** plates, 62 × 62, radius 15, the second at x = 38.
 *
 * Why this file exists rather than a copy in each renderer: the brand kit, the Wallet pass, the
 * verification page and the storyboard all draw the same mark, and the only thing that has stopped
 * them drifting is one source of numbers. The geometry below is the whole specification:
 *
 *   canvas 100 × 62
 *   plate A (left)   62 × 62, radius 15, solid, x = 0
 *   plate B (right)  62 × 62, radius 15, solid, x = 38
 *   overlap          24 units = 24/62 = 38.7% of a plate
 *   lens             the intersection, and the only differentiated element
 *
 * Both plates are solid. The earlier outlined second plate needed a small-size variant to survive
 * 29 px, and a mark with a variant is two marks. The lens alone carries the state:
 * gold active, red revoked, grey expired, paper knockout for one-colour use.
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

/**
 * The mark as an SVG `<g>`, in the 100 × 62 local coordinate system.
 *
 * `plate` and `lens` are colours, not themes, because the pass uses an inverse application on the
 * tinted poster (paper plates) and the one-colour proof uses ink plates with a paper lens.
 */
export function vennGroup({
  x = 0,
  y = 0,
  width = VENN.width,
  plate = "#1A1F71",
  lens = "#F7B600",
  id = "venn",
} = {}) {
  const plateColour = String(plate);
  const lensColour = String(lens);
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
  <rect data-plate="B" x="${VENN.plateB}" y="0" width="${VENN.plate}" height="${VENN.plate}" rx="${VENN.radius}" fill="${plateColour}"/>
  <g clip-path="url(#${clip})">
    <rect data-lens="1" x="${VENN.plateB}" y="0" width="${VENN.plate}" height="${VENN.plate}" rx="${VENN.radius}" fill="${lensColour}"/>
  </g>
</g>`;
}

/** The mark alone as a complete SVG, transparent behind it. Width is the controlling dimension. */
export function vennSvg({ width = 100, plate = "#1A1F71", lens = "#F7B600", background = null, label = "Venn mark" } = {}) {
  const w = Number(width);
  const h = Math.round((w * VENN.height) / VENN.width);
  const bg = background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
  ${bg}${vennGroup({ width: w, plate, lens })}
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
