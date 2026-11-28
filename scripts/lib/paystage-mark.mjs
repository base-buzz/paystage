/**
 * The PayStage mark's numbers, in one place.
 *
 * Approved 2026-11-28 (option **A**, print + wordmark) in the ops session. The spec lives at
 * `ops/docs/proposals/paystage-mark-spec.md`; the approved render is `ps2-A-bigger.png`, bottom proportion.
 *
 * Why a module and not literals in the generator: `scripts/paystage-mark.mjs` draws from it and
 * `scripts/check-brand-assets.mjs` checks the *output* against it. The nine Lucide paths are copied verbatim —
 * never redrawn, never approximated — because the whole point of the family rule is that PayStage and VouchGuard
 * are the same print in different containers.
 *
 * Palette is ink and paper only. Green and red are the product's verdict vocabulary; they never enter the mark.
 * Amber and teal belong to the sibling brand.
 */

/**
 * Lucide `fingerprint-pattern`, 24 × 24 grid, stroke 2. Verbatim from `lucide-react` (ISC, https://lucide.dev),
 * the same set `scripts/lib/mark.mjs` carries for VouchGuard.
 */
const GLYPH_PATHS = Object.freeze([
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

export const PAYSTAGE_MARK = Object.freeze({
  ink: "#0B1020",
  paper: "#FFFFFF",
  /** The name alone, lowercase, as approved. */
  word: "paystage",
  glyph: Object.freeze({
    set: "lucide/fingerprint-pattern",
    grid: 24,
    /** Standalone glyph and the tile keep 2.0; inside the lockup it is 2.2 so the print matches the type. */
    standaloneStroke: 2,
    lockupStroke: 2.2,
    paths: GLYPH_PATHS,
  }),
  lockup: Object.freeze({
    /** Print box height, measured on the 24-grid including the stroke. */
    printHeight: 200,
    /** Gap between the print's advance box and the wordmark's advance box. */
    gapShare: 0.18,
    /** Font size when S = 200. Scales as 0.55 × S. */
    wordSizeAtS200: 110,
    /** The one number that survives a typeface change: wordmark width ÷ S. Approved reference 2.38. */
    wordmarkCap: 2.4,
  }),
  tile: Object.freeze({
    grid: 100,
    radius: 22,
    /** The 24-grid box is 72% of the tile side, centred. */
    printShare: 0.72,
  }),
  /** VouchGuard's palette. Neither may appear in any PayStage asset. */
  forbidden: Object.freeze(["#D4A843", "#1A5F7A"]),
  /** Verdict colours: allowed only on a verdict asset, never on the mark. */
  verdict: Object.freeze({ green: "#22C55E", red: "#B42318" }),
});
