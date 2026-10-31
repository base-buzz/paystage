import { NextResponse } from "next/server";
import {
  SIWE_NONCE_COOKIE,
  SIWE_SESSION_COOKIE,
  SESSION_TTL,
  seal,
  open,
  cookieOptions,
} from "@/lib/siwe/session";
import {
  parseSiweMessage,
  validateSiweFields,
  verifySiweSignature,
  addressesEqual,
} from "@/lib/siwe/message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAIN_ID = 8453;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export async function POST(req: Request) {
  let body: { message?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = body?.message;
  const signature = body?.signature;
  if (typeof message !== "string" || typeof signature !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const nonceToken = readCookie(req, SIWE_NONCE_COOKIE);
  if (!nonceToken) {
    return NextResponse.json({ error: "missing_nonce" }, { status: 401 });
  }

  const opened = await open(nonceToken);
  if (!opened) {
    return NextResponse.json({ error: "nonce_invalid_or_expired" }, { status: 401 });
  }
  const expectedNonce = opened.payload;

  const url = new URL(req.url);
  const expectedDomain = url.host;

  try {
    const parsed = parseSiweMessage(message);
    validateSiweFields(parsed, {
      expectedDomain,
      expectedNonce,
      expectedChainId: CHAIN_ID,
    });
    const recovered = await verifySiweSignature({ message, signature });
    if (!addressesEqual(recovered, parsed.address)) {
      return NextResponse.json({ error: "address_mismatch" }, { status: 401 });
    }

    const sessionToken = await seal(recovered, SESSION_TTL);
    const res = NextResponse.json({
      ok: true,
      address: recovered,
      chainId: CHAIN_ID,
      expiresIn: SESSION_TTL,
    });
    // Single-use nonce: clear immediately after successful verify.
    res.cookies.set(SIWE_NONCE_COOKIE, "", {
      ...cookieOptions({ maxAge: 0 }),
      maxAge: 0,
    });
    res.cookies.set(
      SIWE_SESSION_COOKIE,
      sessionToken,
      cookieOptions({ maxAge: SESSION_TTL }),
    );
    return res;
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "verify_failed";
    return NextResponse.json({ error: messageText }, { status: 401 });
  }
}
