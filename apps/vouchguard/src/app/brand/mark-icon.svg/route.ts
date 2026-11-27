import { renderBrandSvg, svgResponse } from "@/lib/brand-assets";

/** The icon tier: the square tile that replaces the ticket below 64 px. */
export const dynamic = "force-static";

export function GET() {
  const svg = renderBrandSvg("mark-icon.svg");
  return svg ? svgResponse(svg) : new Response("Not found", { status: 404 });
}
