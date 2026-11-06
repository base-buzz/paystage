import { PAYSTAGE_MANIFEST } from "@/lib/agent-manifest";

export const dynamic = "force-static";

/**
 * Served at `/.well-known/paystage.json` (see `middleware.ts`, which rewrites
 * that path here — the App Router does not route dot-prefixed segments).
 */
export function GET() {
  return new Response(JSON.stringify(PAYSTAGE_MANIFEST, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
