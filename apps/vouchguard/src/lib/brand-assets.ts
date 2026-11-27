/**
 * The SVG masters the brand page and the pack download share.
 *
 * These are not files copied into `public/`: the ticket comes from `scripts/lib/mark.mjs`, and the
 * lockups take their wordmark from the repository's `brand.json`. That is what makes the downloads
 * honest — a fork that changes `brand.json` and rebuilds gets its own name in the lockup, not ours.
 */
import brandJson from "../../../../brand.json";
import { MARK, tileSvg, ticketSvg } from "../../../../scripts/lib/mark.mjs";
import { lockupHorizontalSvg, lockupVerticalSvg } from "../../../../scripts/lib/brand-pack.mjs";

type Brand = { name: string; wordmark: string };
const brand = brandJson as Brand;

/** Every SVG the pack exposes, keyed by the filename in `/brand/<name>`. */
export const BRAND_SVG_BY_FILE: Readonly<Record<string, string>> = Object.freeze({
  "mark.svg": ticketSvg({ width: MARK.width, state: "active", label: `${brand.name} ticket` }),
  "mark-revoked.svg": ticketSvg({ width: MARK.width, state: "revoked", label: `${brand.name} ticket, revoked` }),
  "mark-expired.svg": ticketSvg({ width: MARK.width, state: "expired", label: `${brand.name} ticket, expired` }),
  "mark-mono.svg": ticketSvg({ width: MARK.width, mono: true, label: `${brand.name} ticket, one colour` }),
  "mark-icon.svg": tileSvg({ size: 87, label: brand.name }),
  "lockup-vertical.svg": lockupVerticalSvg({ brand }),
  "lockup-horizontal.svg": lockupHorizontalSvg({ brand }),
});

export function renderBrandSvg(file: string): string | null {
  return Object.prototype.hasOwnProperty.call(BRAND_SVG_BY_FILE, file) ? BRAND_SVG_BY_FILE[file] : null;
}

/** One content type for every master, and a cache long enough to be useful but short enough to fix. */
export function svgResponse(svg: string): Response {
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
