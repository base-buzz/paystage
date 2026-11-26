/**
 * The mark, final: **a ticket with two bites** (operator's choice C — teal body, slate stub, amber seal).
 *
 * Two plates on one ticket, a semicircular **bite** out of each end, and the seal as a lens between them. The property the
 * four earlier versions lacked is here: **the state is in the silhouette.** Revoked *removes the right plate* — the stub is
 * torn off and that edge goes flat — so a revoked pass reads as revoked in greyscale, at 16 px and on a photocopy, without
 * relying on anyone reproducing a colour.
 *
 * Master grid, H = 100, everything else a ratio of it:
 *
 *   canvas       184 × 100          1.84 H
 *   corner       26                 0.26 H  (the bites soften the ends; 26 keeps it off a pill)
 *   plate split  x = 92             0.92 H  (canvas centre)
 *   bites        r 17 at (0,50) and (184,50)   0.17 H, cut from both plates
 *   lens         cx 92, w 56, inset 4          0.56 H
 *
 * Colour: body `#1A5F7A`, stub `#7AA2B2`, seal `#D4A843`; revoked seal `#B42318`; expired everything at 55% with a grey
 * seal `#8A8F98`. One-colour: ink 100% / ink 40% / paper knockout.
 *
 * Meaning, in one line, for the pack: *two parties and a seal between them, on a ticket — the body is the authority, the
 * stub is the half someone keeps, and the seal is the record.*
 */

/** The numbers. Exported so a check can disagree with the drawing instead of trusting it. */
export const MARK = Object.freeze({
  width: 184,
  height: 100,
  radius: 26,
  /** where the two plates meet, and the seal's centre */
  split: 92,
  biteRadius: 17,
  lensWidth: 56,
  /** lens width against the span between the bites — 0.56 / 0.66, so it stays a lens and never a bar */
  lensToSpan: 56 / 66,
  lensInset: 4,
  /** the seal, as a path on the H = 100 grid; control points at 0.62 w, 18% / 82% */
  lensPath: "M92 4C126.7 20.6 126.7 79.4 92 96C57.3 79.4 57.3 20.6 92 4Z",
});

/** The named surfaces above, as values rather than themes. */
export const MARK_SURFACES = Object.freeze({
  paper: "#FFFFFF",
  ink: "#101322",
});

/**
 * The mark's own three values. Not page tints: the operator's construction separates the plates by saturated colour, and
 * a mark that borrows a page tint changes whenever the page does.
 */
export const MARK_INK = Object.freeze({
  body: "#1A5F7A",
  stub: "#7AA2B2",
  seal: "#D4A843",
});

/** State, as the seal colour and — for revoked — the absence of the stub. */
export const MARK_STATE = Object.freeze({
  active: { seal: "#D4A843", stub: true, dim: 1 },
  revoked: { seal: "#B42318", stub: false, dim: 1 },
  expired: { seal: "#8A8F98", stub: true, dim: 0.55 },
});

/** One-colour print: ink body, ink 40% stub, paper knockout seal. */
export const MARK_MONO = Object.freeze({
  body: "#101322",
  stub: "#9AA0AA",
  seal: "#FFFFFF",
});

/** Hex → [r, g, b]. Accepts `#RGB` and `#RRGGBB`; anything else is a programming error, not a colour. */
export function parseHex(colour) {
  const hex = String(colour).trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new TypeError(`ticket: not a six-digit hex colour: ${colour}`);
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
  if (!(a >= 0 && a <= 1)) throw new TypeError(`ticket: alpha must be in [0, 1], got ${alpha}`);
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
export function ticketGroup({
  x = 0,
  y = 0,
  width = MARK.width,
  body = MARK_INK.body,
  stub = MARK_INK.stub,
  seal = null,
  state = "active",
  surface = MARK_SURFACES.paper,
} = {}) {
  const k = Number(width) / MARK.width;
  const variant = MARK_STATE[state] ?? MARK_STATE.active;
  // The seal's colour IS the state unless a caller overrides it for a one-colour proof.
  const sealColour = seal ?? variant.seal;
  // Revoked tears the stub off: the right plate is absent and the tear edge is flat, so the state survives greyscale.
  const showStub = variant.stub;
  const dim = variant.dim;
  const opacity = dim === 1 ? "" : ` opacity="${dim}"`;
  // The bites are cutting circles at both end mid-heights, drawn as a mask over the plates.
  const maskId = `ticket-${String(state)}-${MARK.width}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `<g transform="translate(${x} ${y}) scale(${k})"${opacity}>
  <defs>
    <mask id="${maskId}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="${MARK.width + 16}" height="${MARK.height + 16}">
      <rect x="-8" y="-8" width="${MARK.width + 16}" height="${MARK.height + 16}" fill="#FFFFFF"/>
      <circle data-bite="left" cx="0" cy="50" r="${MARK.biteRadius}" fill="#000000"/>
      <circle data-bite="right" cx="${MARK.width}" cy="50" r="${MARK.biteRadius}" fill="#000000"/>
    </mask>
  </defs>
  <g mask="url(#${maskId})">
    <rect data-plate="body" x="0" y="0" width="${MARK.split}" height="${MARK.height}" rx="${MARK.radius}" fill="${body}"/>
    ${showStub ? `<rect data-plate="stub" x="${MARK.split}" y="0" width="${MARK.width - MARK.split}" height="${MARK.height}" rx="${MARK.radius}" fill="${stub}"/>` : ""}
  </g>
  <path data-lens="1" data-role="seal" d="${MARK.lensPath}" fill="${sealColour}"/>
</g>`;
}

/**
 * The mark alone as a complete SVG. Width is the controlling dimension; the height follows the master's ratio.
 */
/** The mark alone as a complete SVG, transparent behind it. Width is the controlling dimension. */
export function ticketSvg({
  width = 272,
  plate = MARK_INK.plateA,
  plateB = MARK_INK.plateB,
  lens = MARK_INK.lens,
  background = null,
  surface = background ?? MARK_SURFACES.paper,
  label = "Ticket mark",
} = {}) {
  const w = Number(width);
  const h = Math.round((w * MARK.height) / MARK.width);
  const bg = background === null ? "" : `<rect width="${w}" height="${h}" fill="${background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${MARK.width} ${MARK.height}" role="img" aria-label="${label}">
  ${bg}
  ${ticketGroup({ width: MARK.width, plate, plateB, lens, surface })}
</svg>`;
}

export function sealPx(markWidth) {
  return (MARK.lensWidth / MARK.width) * Number(markWidth);
}
