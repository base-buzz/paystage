import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * `/.well-known/paystage.json` is the conventional discovery path for agents.
 * The App Router ignores dot-prefixed segments, so the manifest lives at
 * `/agent-manifest.json` and this rewrite gives it the well-known spelling too.
 */
const WELL_KNOWN_MANIFEST = "/.well-known/paystage.json";

/**
 * `/.well-known/x402` on the apex, for directory discovery.
 *
 * x402scan's register form checks the domain you type — and it checks `paystage.xyz`, not
 * `api.paystage.xyz`, where the document actually lives. Serving it only on the API host meant the
 * check answered "No discovery document found" while the document was one subdomain away.
 *
 * The rewrite targets a route handler so the list stays derived from one constant instead of a static
 * file that drifts.
 */
const WELL_KNOWN_X402 = "/.well-known/x402";

/**
 * `Accept: text/markdown` on `/` is the one landing-page change that reduces an agent's token cost.
 *
 * The HTML stays canonical; a caller that says it reads markdown gets the same facts from `/index.md`.
 * No content negotiation is attempted for other types — a browser sends `text/html`, so it never
 * reaches this branch, and a cache must key on `Accept` because the response body differs.
 */
const INDEX_MD = "/index.md";

function acceptsMarkdown(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return /\btext\/markdown\b/i.test(accept);
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  if (host === "www.paystage.xyz") {
    const url = request.nextUrl.clone();
    url.host = "paystage.xyz";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }

  if (
    request.nextUrl.pathname === "/" &&
    (request.method === "GET" || request.method === "HEAD") &&
    acceptsMarkdown(request)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = INDEX_MD;
    return NextResponse.rewrite(url);
  }

  if (request.nextUrl.pathname === WELL_KNOWN_X402) {
    const url = request.nextUrl.clone();
    url.pathname = "/x402/discovery";
    return NextResponse.rewrite(url);
  }

  if (request.nextUrl.pathname === WELL_KNOWN_MANIFEST) {
    const url = request.nextUrl.clone();
    url.pathname = "/agent-manifest.json";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
