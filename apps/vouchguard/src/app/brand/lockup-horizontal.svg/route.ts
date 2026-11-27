import { renderBrandSvg, svgResponse } from "@/lib/brand-assets";

/** Horizontal lockup: wordmark from `brand.json`, for headers and narrow spaces. */
export const dynamic = "force-static";

export function GET() {
  const svg = renderBrandSvg("lockup-horizontal.svg");
  return svg ? svgResponse(svg) : new Response("Not found", { status: 404 });
}
