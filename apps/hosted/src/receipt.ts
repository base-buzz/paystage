/**
 * Verdict receipts.
 *
 * A receipt binds a decision to the exact inputs that produced it: the request
 * digest, the policy digest, the service version and the time. It is the
 * accounting anchor (what was decided, over what, when) and, once a signing key
 * is provisioned, the authenticity proof.
 *
 * Design constraints, in order:
 *  - Never change a verdict. The receipt wraps the decision; it does not
 *    influence it. `evaluate` stays the only authority.
 *  - Deterministic. The same inputs must canonicalize to the same bytes, or a
 *    third party cannot reproduce the digest.
 *  - Honest when unsigned. With no key configured the receipt is emitted with
 *    `signed: false` and no signature — never a placeholder or a fake.
 */

export const RECEIPT_VERSION = 1;
export const RECEIPT_ALG = "ECDSA-P256-SHA256";
export const RECEIPT_KEY_ID = "paystage-receipt-v1";

/** JSON with recursively sorted keys and no insignificant whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalize(value));
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface ReceiptPayload {
  v: number;
  issuer: string;
  issued_at: string;
  service: { name: string; version: string };
  verdict: { decision: string; reasons: string[]; summary?: string };
  request_sha256: string;
  policy_sha256: string;
}

export interface Receipt extends ReceiptPayload {
  signed: boolean;
  alg?: string;
  key_id?: string;
  signature?: string;
}

export interface BuildReceiptInput {
  decision: { decision: string; reasons?: string[]; summary?: string };
  request: unknown;
  policy: unknown;
  signingKeyPkcs8B64?: string | undefined;
  now?: Date;
  serviceVersion?: string;
}

/** Import a PKCS#8 base64 key once per isolate. */
let cachedKey: { material: string; key: CryptoKey } | undefined;

async function signingKey(pkcs8B64: string): Promise<CryptoKey | undefined> {
  if (cachedKey?.material === pkcs8B64) return cachedKey.key;
  try {
    const raw = Uint8Array.from(atob(pkcs8B64), (ch) => ch.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8",
      raw,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    cachedKey = { material: pkcs8B64, key };
    return key;
  } catch {
    return undefined;
  }
}

/**
 * Build a receipt for one decision. Signature failures degrade to an unsigned
 * receipt rather than failing the request: a verdict must never be withheld
 * because of an accounting problem.
 */
export async function buildReceipt(input: BuildReceiptInput): Promise<Receipt> {
  const payload: ReceiptPayload = {
    v: RECEIPT_VERSION,
    issuer: "paystage",
    issued_at: (input.now ?? new Date()).toISOString(),
    service: { name: "@paystage/hosted", version: input.serviceVersion ?? "0.0.0" },
    verdict: {
      decision: input.decision.decision,
      reasons: input.decision.reasons ?? [],
      ...(input.decision.summary === undefined ? {} : { summary: input.decision.summary }),
    },
    request_sha256: await sha256Hex(input.request),
    policy_sha256: await sha256Hex(input.policy),
  };

  const unsigned: Receipt = { ...payload, signed: false };
  if (!input.signingKeyPkcs8B64) return unsigned;

  const key = await signingKey(input.signingKeyPkcs8B64);
  if (key === undefined) return unsigned;

  try {
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(canonicalize(payload)),
    );
    return {
      ...payload,
      signed: true,
      alg: RECEIPT_ALG,
      key_id: RECEIPT_KEY_ID,
      signature: base64Url(signature),
    };
  } catch {
    return unsigned;
  }
}

/** Public half of the signing key, as a JWK with the private members removed. */
export async function publicKeyJwk(pkcs8B64: string): Promise<JsonWebKey | undefined> {
  try {
    const raw = Uint8Array.from(atob(pkcs8B64), (ch) => ch.charCodeAt(0));
    const priv = await crypto.subtle.importKey(
      "pkcs8",
      raw,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );
    const jwk = (await crypto.subtle.exportKey("jwk", priv)) as JsonWebKey;
    // Drop the private member and `key_ops`: an exported private JWK carries
    // key_ops:["sign"], and importing that for verification fails with
    // "Key operations and usage mismatch".
    const { d: _d, key_ops: _ops, ...pub } = jwk;
    return pub;
  } catch {
    return undefined;
  }
}

/**
 * Verify a receipt with the published public key. Shipped so a caller does not
 * have to reimplement canonicalization — the most common way to get this wrong.
 */
export async function verifyReceipt(
  receipt: Receipt,
  jwk: JsonWebKey,
): Promise<"valid" | "invalid" | "unsigned" | "malformed"> {
  if (!receipt || typeof receipt !== "object") return "malformed";
  if (receipt.signed !== true) return "unsigned";
  if (typeof receipt.signature !== "string" || typeof receipt.key_id !== "string") return "malformed";
  const { signed: _s, alg: _a, key_id: _k, signature, ...payload } = receipt;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const sig = Uint8Array.from(
      atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (signature.length % 4)) % 4)),
      (ch) => ch.charCodeAt(0),
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      new TextEncoder().encode(canonicalize(payload)),
    );
    return ok ? "valid" : "invalid";
  } catch {
    return "malformed";
  }
}
