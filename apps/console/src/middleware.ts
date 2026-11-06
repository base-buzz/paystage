import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * `/.well-known/paystage.json` is the conventional discovery path for agents.
 * The App Router ignores dot-prefixed segments, so the manifest lives at
 * `/agent-manifest.json` and this rewrite gives it the well-known spelling too.
 */
const WELL_KNOWN_MANIFEST = "/.well-known/paystage.json";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  if (host === "www.paystage.xyz") {
    const url = request.nextUrl.clone();
    url.host = "paystage.xyz";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
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
