/**
 * HMAC-sealed short-lived tokens for SIWE nonce + session cookies.
 * Web Crypto only (Cloudflare Workers + Node).
 */

export const SIWE_NONCE_COOKIE = "paystage_siwe_nonce";
export const SIWE_SESSION_COOKIE = "paystage_siwe_session";
export const NONCE_TTL = 300;
export const SESSION_TTL = 3600;

export interface OpenResult {
  payload: string;
  exp: number;
}

export interface CookieOptions {
  maxAge: number;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
}

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("Web Crypto subtle is unavailable");
  }
  return c.subtle;
}

function getSecret(): string {
  const secret = process.env.SIWE_SESSION_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      "SIWE_SESSION_SECRET is not set. Configure it before signing or verifying SIWE sessions.",
    );
  }
  return secret;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return getSubtle().importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await importKey(secret);
  const sig = await getSubtle().sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function seal(payload: string, ttlSeconds: number): Promise<string> {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signingInput = `v1|${payload}|${exp}`;
  const mac = await hmac(secret, signingInput);
  return `v1.${base64urlEncode(new TextEncoder().encode(payload))}.${exp}.${base64urlEncode(mac)}`;
}

export async function open(token: string): Promise<OpenResult | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, payloadB64, expStr, macB64] = parts;
  if (version !== "v1" || !payloadB64 || !expStr || !macB64) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || !Number.isInteger(exp)) return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;

  let payload: string;
  let providedMac: Uint8Array;
  try {
    payload = new TextDecoder().decode(base64urlDecode(payloadB64));
    providedMac = base64urlDecode(macB64);
  } catch {
    return null;
  }

  const secret = getSecret();
  const signingInput = `v1|${payload}|${exp}`;
  const expectedMac = await hmac(secret, signingInput);
  if (!constantTimeEqual(expectedMac, providedMac)) return null;

  return { payload, exp };
}

export function cookieOptions({ maxAge }: { maxAge: number }): CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  const onCf = Boolean(
    process.env.CF_PAGES ||
      process.env.CF_WORKER ||
      process.env.CLOUDFLARE_ENV ||
      process.env.NEXT_PUBLIC_STATUS_URL?.includes("paystage"),
  );
  return {
    maxAge,
    httpOnly: true,
    secure: isProd || onCf,
    sameSite: "lax",
    path: "/",
  };
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
