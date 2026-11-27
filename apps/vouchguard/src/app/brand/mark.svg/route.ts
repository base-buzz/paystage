import { renderBrandSvg, svgResponse } from "@/lib/brand-assets";

/** The full ticket, straight from `scripts/lib/mark.mjs`. */
export const dynamic = "force-static";

export function GET() {
  const svg = renderBrandSvg("mark.svg");
  return svg ? svgResponse(svg) : new Response("Not found", { status: 404 });
}
