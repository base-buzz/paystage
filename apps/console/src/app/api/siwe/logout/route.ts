import { NextResponse } from "next/server";
import {
  SIWE_NONCE_COOKIE,
  SIWE_SESSION_COOKIE,
  cookieOptions,
} from "@/lib/siwe/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const cleared = { ...cookieOptions({ maxAge: 0 }), maxAge: 0 };
  res.cookies.set(SIWE_NONCE_COOKIE, "", cleared);
  res.cookies.set(SIWE_SESSION_COOKIE, "", cleared);
  return res;
}
