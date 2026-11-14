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

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  if (host === "www.paystage.xyz") {
    const url = request.nextUrl.clone();
    url.host = "paystage.xyz";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
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
