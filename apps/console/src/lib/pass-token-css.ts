import { PASS_TOKENS } from "@/lib/pass-tokens";

/**
 * The pass token file as CSS custom properties on `:root`.
 *
 * `/m/:serial` wrote this inline before `/verify` and `/v/:serial` needed the same values. It lives here now so the
 * three pages cannot drift into three transcriptions of `pass-tokens.json` — which is the file the Wallet renderer
 * reads, and the reason the page and the pass share a palette at all (#440).
 *
 * Every colour and size below comes from the JSON. A page that adds a colour here is adding a fourth answer to the
 * same question.
 */
const { palette, type, spacing, geometry } = PASS_TOKENS;

export const PASS_TOKEN_CSS = [
  ":root{",
  `--pass-ink:${palette.ink};`,
  `--pass-paper:${palette.paper};`,
  `--pass-deep:${palette.deep};`,
  `--pass-gold:${palette.gold};`,
  `--pass-muted:${palette.muted};`,
  `--pass-red:${palette.red};`,
  /* The public record carries no teammate name, so the default tint is the one `tintFor("")` returns. */
  `--pass-tint:${PASS_TOKENS.posterTints[0]};`,
  `--pass-type-name:${type.name};`,
  `--pass-type-value:${type.value};`,
  `--pass-type-label:${type.label};`,
  `--pass-type-caption:${type.caption};`,
  `--pass-type-field-label:${type.fieldLabel};`,
  `--pass-type-field:${type.field};`,
  `--pass-type-brand:${type.brand};`,
  `--pass-type-sub-brand:${type.subBrand};`,
  `--pass-type-chip:${type.chip};`,
  `--pass-type-meta:${type.meta};`,
  `--pass-pad:${spacing.pad};`,
  /* The pass's poster band, as an aspect ratio: full height × the bare (no-teammate) poster share. */
  `--pass-poster-aspect:${(geometry.aspect * geometry.posterShareBare).toFixed(4)};`,
  "}",
].join("");
