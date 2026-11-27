import { renderBrandSvg, svgResponse } from "@/lib/brand-assets";

/** The expired state: white print becomes `#8A8F98`; the ticket does not change. */
export const dynamic = "force-static";

export function GET() {
  const svg = renderBrandSvg("mark-expired.svg");
  return svg ? svgResponse(svg) : new Response("Not found", { status: 404 });
}
