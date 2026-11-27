import { renderBrandSvg, svgResponse } from "@/lib/brand-assets";

/** One-colour: ink body, paper print, for print and plain-text contexts. */
export const dynamic = "force-static";

export function GET() {
  const svg = renderBrandSvg("mark-mono.svg");
  return svg ? svgResponse(svg) : new Response("Not found", { status: 404 });
}
