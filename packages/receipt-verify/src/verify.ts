/**
 * Verify a PayStage verdict receipt without installing the server.
 *
 * A receipt is proof rather than a claim only if a third party can check it with the receipt and a
 * fetch. This is that path: the same verdict shape as `packages/mcp/src/verify.ts`, with no server
 * import and no dependency on `@paystage/mcp`. Canonicalisation (sorted keys, no whitespace) and
 * signature encoding (WebCrypto raw `r||s`) must match the issuer byte for byte.
 *
 * This verifier is **ES256 only** (ECDSA P-256 + SHA-256): it validates what it knows and refuses
 * the rest rather than following the issuer upward.
 */
const webcrypto = globalThis.crypto;
const RECEIPT_VERSION = 1;
/** The `alg` the issuer writes into a receipt. */
export const RECEIPT_ALG = "ECDSA-P256-SHA256";
/** The JWKS algorithm identifier for the same key. */
export const JWK_ALG = "ES256";
/** Standard JWKS path; the legacy `/v1/public/receipt-key.json` answers the same keys. */
export const DEFAULT_KEY_URL = "https://api.paystage.xyz/.well-known/paystage-receipt-key.json";
/** How far ahead of the verifier's clock an `issued_at` may be. Five minutes covers honest skew. */
const MAX_CLOCK_SKEW_SECONDS = 300;
/** Minimal JWK shape: the fields Web Crypto reads, without a lib.dom dependency. */
export interface JwkLike {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  kid?: string;
  use?: string;
  alg?: string;
  [key: string]: unknown;
}
/** JSON with recursively sorted keys and no insignificant whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}
/** SHA-256 over the canonical form, lowercase hex — the issuer's rule. */
async function sha256Hex(value: unknown): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function base64UrlToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
/** Age in seconds, or null when `issued_at` is not a timestamp. */
function ageSeconds(issuedAt: unknown, now: Date | undefined): number | null {
  if (typeof issuedAt !== "string") return null;
  const then = Date.parse(issuedAt);
  return Number.isNaN(then) ? null : ((now ?? new Date()).getTime() - then) / 1000;
}
export interface ReceiptLike {
  signed?: boolean;
  alg?: string;
  key_id?: string;
  signature?: string;
  v?: number;
  issuer?: string;
  issued_at?: string;
  expires_at?: string;
  payment?: { scheme?: string; network?: string; asset?: string; amount?: string; payee?: string };
  service?: { name?: string; version?: string };
  verdict?: { decision?: string; reasons?: string[]; summary?: string };
  request_sha256?: string;
  policy_sha256?: string;
  [key: string]: unknown;
}
/** Fields added by signing. Everything else is the signed payload. */
const SIGNATURE_FIELDS = ["signed", "alg", "key_id", "signature"] as const;
export function receiptPayload(receipt: ReceiptLike): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(receipt)) {
    if (!(SIGNATURE_FIELDS as readonly string[]).includes(key)) payload[key] = value;
  }
  return payload;
}
export interface VerifyOptions {
  /** Published JWK. Fetched from DEFAULT_KEY_URL when omitted. */
  jwk?: JwkLike;
  /** Inputs to check the receipt against; their digests are recomputed rather than taken on trust. */
  expectedRequest?: unknown;
  expectedPolicy?: unknown;
  /** Reject a receipt older than this many seconds. A bound set by the verifier, not the issuer. */
  maxAgeSeconds?: number;
  /** Injectable clock, so freshness tests do not depend on wall time. */
  now?: Date;
  /** The payment this receipt is being checked against. */
  payment?: { scheme?: string; network?: string; asset?: string; amount?: string; payee?: string };
  /** Override for tests and point-in-time checks. */
  keyUrl?: string;
  fetchImpl?: typeof fetch;
}
export type KeySource = "published" | "supplied";
export type VerifyVerdict =
  | { ok: true; status: "signed-and-valid"; verdict?: string; issued_at?: string; key_id?: string; key_source: KeySource }
  | { ok: false; status: "expired"; reason: string; expires_at: string; expired_by_seconds: number }
  | { ok: false; status: "payment-mismatch"; reason: string; mismatched: string[] }
  | { ok: false; status: "stale"; reason: string; age_seconds: number; max_age_seconds: number }
  | { ok: false; status: "inputs-mismatch"; reason: string; mismatched: Array<"request" | "policy"> }
  | { ok: false; status: "unsigned"; reason: string; inputs?: "match" | "mismatch"; mismatched?: Array<"request" | "policy"> }
  | { ok: false; status: "invalid"; reason: string }
  | { ok: false; status: "unverifiable"; reason: string };
/** Fetch and select a key, or return the verdict saying why nothing can be checked. */
async function publishedKey(receipt: ReceiptLike, options: VerifyOptions): Promise<{ jwk: JwkLike } | { error: VerifyVerdict }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.keyUrl ?? DEFAULT_KEY_URL);
    if (!res.ok) return { error: { ok: false, status: "unverifiable", reason: `key endpoint returned ${res.status}` } };
    // Two shapes: a JWKS (`{ keys: [...] }`) and the original single key (`{ jwk }`). Selection is by
    // the `key_id` the receipt carries, so rotation stays additive.
    const body = (await res.json()) as { configured?: boolean; jwk?: JwkLike; keys?: JwkLike[] };
    const keys = body.keys ?? [];
    if (keys.length > 0) {
      const match = receipt.key_id === undefined ? keys[0] : keys.find((k) => k.kid === receipt.key_id);
      if (match === undefined) {
        return {
          error: {
            ok: false,
            status: "unverifiable",
            reason: `the published key set has no key with kid ${String(receipt.key_id)} — the receipt names a key this issuer does not publish`,
          },
        };
      }
      return { jwk: match };
    }
    if (body.configured === true && body.jwk !== undefined) return { jwk: body.jwk };
    return { error: { ok: false, status: "unverifiable", reason: "issuer has not published a signing key, so nothing can be checked" } };
  } catch (error) {
    return { error: { ok: false, status: "unverifiable", reason: `could not fetch the key: ${error instanceof Error ? error.message : String(error)}` } };
  }
}
/**
 * Check a receipt. Returns a verdict rather than throwing, because "I could not check this" is a
 * distinct outcome from "this is forged".
 */
export async function verifyReceipt(receipt: ReceiptLike, options: VerifyOptions = {}): Promise<VerifyVerdict> {
  if (receipt === null || typeof receipt !== "object") return { ok: false, status: "invalid", reason: "receipt is not an object" };
  if (receipt.v !== undefined && receipt.v !== RECEIPT_VERSION) {
    return {
      ok: false,
      status: "invalid",
      reason: `unsupported receipt version ${String(receipt.v)} (this verifier understands ${RECEIPT_VERSION})`,
    };
  }
  const decision = receipt.verdict?.decision;
  if (decision !== undefined && !["pay", "review", "do_not_pay"].includes(decision)) {
    return { ok: false, status: "invalid", reason: `unknown verdict ${JSON.stringify(decision)} — expected pay, review or do_not_pay` };
  }
  const digestMismatches = async (): Promise<Array<"request" | "policy">> => {
    const mismatched: Array<"request" | "policy"> = [];
    for (const [expected, claimed, which] of [
      [options.expectedRequest, receipt.request_sha256, "request"],
      [options.expectedPolicy, receipt.policy_sha256, "policy"],
    ] as const) {
      if (expected !== undefined && (typeof claimed !== "string" || (await sha256Hex(expected)) !== claimed)) {
        mismatched.push(which);
      }
    }
    return mismatched;
  };
  if (receipt.signed !== true) {
    const mismatched = await digestMismatches();
    return {
      ok: false,
      status: "unsigned",
      reason: "receipt carries no signature — it is useful as a record of what was decided, but it cannot prove who decided it",
      ...(options.expectedRequest === undefined && options.expectedPolicy === undefined
        ? {}
        : { inputs: mismatched.length === 0 ? "match" : "mismatch", mismatched }),
    };
  }
  if (typeof receipt.signature !== "string" || receipt.signature.length === 0) {
    return { ok: false, status: "invalid", reason: "signed: true but no signature field" };
  }
  if (receipt.alg !== undefined && receipt.alg !== RECEIPT_ALG) {
    return { ok: false, status: "invalid", reason: `unexpected alg: ${receipt.alg} — this verifier is ES256-only` };
  }
  let jwk = options.jwk;
  if (jwk === undefined) {
    const found = await publishedKey(receipt, options);
    if ("error" in found) return found.error;
    jwk = found.jwk;
  }
  // ES256 only: refuse a key that names another curve or algorithm rather than importing and hoping.
  if (jwk.kty !== "EC" || String(jwk.crv) !== "P-256" || (jwk.alg !== undefined && jwk.alg !== JWK_ALG)) {
    return {
      ok: false,
      status: "invalid",
      reason: `the verifying key is not an ES256 (P-256) key: kty=${String(jwk.kty)} crv=${String(jwk.crv)} alg=${String(jwk.alg)}`,
    };
  }
  const data = new TextEncoder().encode(canonicalize(receiptPayload(receipt)));
  let signature: Uint8Array<ArrayBuffer>;
  try {
    const decoded = base64UrlToBytes(receipt.signature);
    // Copy into a plain ArrayBuffer so the BufferSource type is exact under TS 5.9's generic typed arrays.
    signature = new Uint8Array(decoded.length);
    signature.set(decoded);
  } catch {
    return { ok: false, status: "invalid", reason: "signature is not valid base64url" };
  }
  try {
    const publicKey = await webcrypto.subtle.importKey("jwk", jwk as unknown as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    // WebCrypto's ECDSA verify with SHA-256 is ES256; the curve and JWK alg are pinned above.
    const valid = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, data);
    if (!valid) {
      return {
        ok: false,
        status: "invalid",
        reason: "signature does not match the payload — the receipt was altered or was signed by a different key",
      };
    }
    // Only with the signature proven is it worth asking whether the receipt covers the caller's inputs.
    const mismatched = await digestMismatches();
    if (mismatched.length > 0) {
      return {
        ok: false,
        status: "inputs-mismatch",
        reason: `signature is valid but the receipt does not cover the supplied ${mismatched.join(" and ")} input`,
        mismatched,
      };
    }
    // A signed receipt carries its own lifetime. Checked after the signature: an expired *signed*
    // receipt is the case that matters, and an unsigned one is already not trusted.
    if (receipt.expires_at !== undefined) {
      const expiresAt = Date.parse(receipt.expires_at);
      const now = options.now ?? new Date();
      if (Number.isNaN(expiresAt)) {
        return { ok: false, status: "invalid", reason: `expires_at is not a parseable timestamp: ${JSON.stringify(receipt.expires_at)}` };
      }
      if (now.getTime() > expiresAt) {
        const expiredBy = Math.round((now.getTime() - expiresAt) / 1000);
        return {
          ok: false,
          status: "expired",
          reason: `this decision expired ${expiredBy}s ago (${receipt.expires_at}); ask for a fresh evaluation`,
          expires_at: receipt.expires_at,
          expired_by_seconds: expiredBy,
        };
      }
    }
    if (options.payment !== undefined) {
      const bound = receipt.payment;
      if (bound === undefined) {
        return {
          ok: false,
          status: "payment-mismatch",
          reason: "this receipt predates payment binding, so it cannot be shown to be about the supplied payment",
          mismatched: ["binding"],
        };
      }
      const fields = (["scheme", "network", "asset", "amount", "payee"] as const).filter((field) => {
        const wanted = options.payment?.[field];
        return wanted !== undefined && String(wanted) !== String(bound[field]);
      });
      if (fields.length > 0) {
        return {
          ok: false,
          status: "payment-mismatch",
          reason: `signature is valid but the receipt covers a different payment (${fields.join(", ")})`,
          mismatched: fields,
        };
      }
    }
    if (options.maxAgeSeconds !== undefined) {
      const age = ageSeconds(receipt.issued_at, options.now);
      if (age === null) return { ok: false, status: "invalid", reason: `issued_at is not a parseable timestamp: ${JSON.stringify(receipt.issued_at)}` };
      if (age < -MAX_CLOCK_SKEW_SECONDS) {
        return {
          ok: false,
          status: "invalid",
          reason: `issued_at is ${Math.round(-age)}s in the future, beyond any plausible clock skew — this receipt could not have been issued yet`,
        };
      }
      if (age > options.maxAgeSeconds) {
        return {
          ok: false,
          status: "stale",
          reason: `receipt is ${Math.round(age)}s old, older than the ${options.maxAgeSeconds}s bound`,
          age_seconds: age,
          max_age_seconds: options.maxAgeSeconds,
        };
      }
    }
    return {
      ok: true,
      status: "signed-and-valid",
      verdict: receipt.verdict?.decision,
      issued_at: receipt.issued_at,
      key_id: receipt.key_id,
      key_source: options.jwk !== undefined || options.keyUrl !== undefined ? "supplied" : "published",
    };
  } catch (error) {
    return { ok: false, status: "invalid", reason: `could not verify: ${error instanceof Error ? error.message : String(error)}` };
  }
}
