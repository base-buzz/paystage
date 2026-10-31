import { NextResponse } from "next/server";
import {
  SIWE_NONCE_COOKIE,
  NONCE_TTL,
  seal,
  cookieOptions,
  randomNonce,
} from "@/lib/siwe/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const nonce = randomNonce();
    const token = await seal(nonce, NONCE_TTL);
    const url = new URL(req.url);
    const res = NextResponse.json({
      nonce,
      domain: url.host,
      chainId: 8453,
      ttlSeconds: NONCE_TTL,
    });
    res.cookies.set(SIWE_NONCE_COOKIE, token, cookieOptions({ maxAge: NONCE_TTL }));
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "nonce_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
