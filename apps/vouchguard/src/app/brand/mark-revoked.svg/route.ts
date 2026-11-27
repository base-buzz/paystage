import { renderBrandSvg, svgResponse } from "@/lib/brand-assets";

/** The revoked state: white print becomes `#B42318`; the ticket does not change. */
export const dynamic = "force-static";

export function GET() {
  const svg = renderBrandSvg("mark-revoked.svg");
  return svg ? svgResponse(svg) : new Response("Not found", { status: 404 });
}
