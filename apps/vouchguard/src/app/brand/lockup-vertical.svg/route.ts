import { renderBrandSvg, svgResponse } from "@/lib/brand-assets";

/** Vertical lockup: wordmark from `brand.json`, pinned to the symbol's width. */
export const dynamic = "force-static";

export function GET() {
  const svg = renderBrandSvg("lockup-vertical.svg");
  return svg ? svgResponse(svg) : new Response("Not found", { status: 404 });
}
