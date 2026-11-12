/**
 * Receipt verification.
 *
 * A receipt says "this decision was made, over these inputs, at this time". Until
 * someone can check the signature without trusting us, that sentence is a claim
 * rather than a proof — so this module exists to be run by strangers.
 *
 * The two things that must match the issuer byte for byte:
 *
 *  1. **Canonicalisation.** JSON with sorted keys and no whitespace. If this drifts
 *     from `apps/hosted/src/receipt.ts`, every valid receipt reports `invalid`, which
 *     is worse than not shipping the check at all.
 *  2. **Signature encoding.** WebCrypto (the issuer) emits raw `r||s`; Node's default
 *     is DER. Getting this wrong produces the same failure mode, so it is pinned to
 *     `ieee-p1363` explicitly.
 */

import { createPublicKey, verify as nodeVerify, webcrypto } from "node:crypto";

/** The receipt format version this verifier understands. Kept local on purpose: a verifier
 *  must not silently follow the issuer's constant upward — it validates what it knows. */
const RECEIPT_VERSION = 1;


/** Minimal JWK shape. The DOM lib's JsonWebKey is not available in a Node-only build. */
export interface JwkLike {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  [key: string]: unknown;
}

export const RECEIPT_ALG = "ECDSA-P256-SHA256";
export const DEFAULT_KEY_URL = "https://api.paystage.xyz/v1/public/receipt-key.json";

/** JSON with recursively sorted keys and no insignificant whitespace. */
/**
 * How far ahead of the verifier's clock an `issued_at` may be before it is refused.
 *
 * A future-dated receipt is not "fresh" — it is a receipt that could not have been issued
 * yet, and without this check `age > maxAge` is never true for it, so it never expires.
 * Five minutes covers honest clock skew between two machines.
 */
const MAX_CLOCK_SKEW_SECONDS = 300;

/** Age in seconds, or null when `issued_at` is not a timestamp. */
function ageSeconds(issuedAt: unknown, now: Date | undefined): number | null {
  if (typeof issuedAt !== "string") return null;
  const then = Date.parse(issuedAt);
  if (Number.isNaN(then)) return null;
  return ((now ?? new Date()).getTime() - then) / 1000;
}

/** SHA-256 over the canonical form, lowercase hex — same rule the issuer used. */
async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export interface ReceiptLike {
  signed?: boolean;
  alg?: string;
  key_id?: string;
  signature?: string;
  v?: number;
  issuer?: string;
  issued_at?: string;
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
    if ((SIGNATURE_FIELDS as readonly string[]).includes(key)) continue;
    payload[key] = value;
  }
  return payload;
}

export interface VerifyOptions {
  /** Published JWK. Fetched from DEFAULT_KEY_URL when omitted. */
  jwk?: JwkLike;
  /**
   * Inputs to check the receipt against. When supplied, the receipt's stated digests are
   * recomputed over these values instead of being taken on trust — which is the difference
   * between a receipt as a record and a receipt as evidence.
   */
  expectedRequest?: unknown;
  expectedPolicy?: unknown;
  /**
   * Reject a receipt older than this many seconds. A bound set by the *verifier*, not the
   * issuer: nothing in the signed payload says how long a verdict is meant to hold, and
   * inventing that would be a format change (`v: 2`). Boundary is inclusive — a receipt
   * exactly at the limit is still fresh.
   */
  maxAgeSeconds?: number;
  /** Injectable clock, so freshness tests do not depend on wall time. */
  now?: Date;
  /** Override for tests and for point-in-time checks. */
  keyUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Where the verifying key came from. A machine consumer must be able to tell "verified
 * against PayStage's published key" from "verified against a key someone handed me" — the
 * human output said this all along, and `--json` did not, which is the difference between a
 * receipt and a receipt-shaped claim.
 */
export type KeySource = "published" | "supplied";

export type VerifyVerdict =
  | {
      ok: false;
      status: "stale";
      reason: string;
      /** Age in seconds, and the bound that was exceeded. */
      age_seconds: number;
      max_age_seconds: number;
    }
  | {
      ok: false;
      status: "inputs-mismatch";
      reason: string;
      /** Which digest disagreed: "request", "policy", or both. */
      mismatched: Array<"request" | "policy">;
    }
  | {
      ok: true;
      status: "signed-and-valid";
      verdict?: string;
      issued_at?: string;
      key_id?: string;
      key_source: KeySource;
    }
  | {
      ok: false;
      status: "unsigned";
      reason: string;
      /** Present only when --request/--policy were supplied: does the receipt cover them? */
      inputs?: "match" | "mismatch";
      mismatched?: Array<"request" | "policy">;
    }
  | { ok: false; status: "invalid"; reason: string }
  | { ok: false; status: "unverifiable"; reason: string };

function base64UrlToBuffer(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

/**
 * Check a receipt. Returns a verdict rather than throwing, because "I could not check
 * this" is a distinct and important outcome from "this is forged".
 */
export async function verifyReceipt(
  receipt: ReceiptLike,
  options: VerifyOptions = {},
): Promise<VerifyVerdict> {
  if (receipt === null || typeof receipt !== "object") {
    return { ok: false, status: "invalid", reason: "receipt is not an object" };
  }

  // A receipt from a future format version may mean something this code does not check.
  // Validating it would assert more than we know.
  if (receipt.v !== undefined && receipt.v !== RECEIPT_VERSION) {
    return {
      ok: false,
      status: "invalid",
      reason: `unsupported receipt version ${String(receipt.v)} (this verifier understands ${RECEIPT_VERSION})`,
    };
  }

  // The verdict is what a caller acts on, so an unknown value is a refusal, not a pass.
  const verdictValue = receipt.verdict?.decision;
  if (verdictValue !== undefined && !["pay", "review", "do_not_pay"].includes(verdictValue)) {
    return {
      ok: false,
      status: "invalid",
      reason: `unknown verdict ${JSON.stringify(verdictValue)} — expected pay, review or do_not_pay`,
    };
  }

  if (receipt.signed !== true) {
    // No signature means the digest is the only evidence there is, so the recompute still
    // runs. The status stays `unsigned` (exit 2): an unsigned receipt cannot be forged, so
    // a mismatch here is not a forgery verdict.
    const mismatchedUnsigned: Array<"request" | "policy"> = [];
    const checkUnsigned = async (expected: unknown, claimed: unknown, which: "request" | "policy") => {
      if (expected === undefined) return;
      if (typeof claimed !== "string") {
        mismatchedUnsigned.push(which);
        return;
      }
      if ((await sha256Hex(expected)) !== claimed) mismatchedUnsigned.push(which);
    };
    await checkUnsigned(options.expectedRequest, receipt.request_sha256, "request");
    await checkUnsigned(options.expectedPolicy, receipt.policy_sha256, "policy");

    return {
      ok: false,
      status: "unsigned",
      reason:
        "receipt carries no signature — it is still useful as a record of what was decided, but it cannot prove who decided it",
      ...(options.expectedRequest === undefined && options.expectedPolicy === undefined
        ? {}
        : { inputs: mismatchedUnsigned.length === 0 ? "match" : "mismatch", mismatched: mismatchedUnsigned }),
    };
  }

  if (typeof receipt.signature !== "string" || receipt.signature.length === 0) {
    return { ok: false, status: "invalid", reason: "signed: true but no signature field" };
  }

  if (receipt.alg !== undefined && receipt.alg !== RECEIPT_ALG) {
    return { ok: false, status: "invalid", reason: `unexpected alg: ${receipt.alg}` };
  }

  let jwk = options.jwk;
  if (jwk === undefined) {
    const url = options.keyUrl ?? DEFAULT_KEY_URL;
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        return { ok: false, status: "unverifiable", reason: `key endpoint returned ${res.status}` };
      }
      const body = (await res.json()) as { configured?: boolean; jwk?: JwkLike };
      if (body.configured !== true || body.jwk === undefined) {
        return {
          ok: false,
          status: "unverifiable",
          reason: "issuer has not published a signing key, so nothing can be checked",
        };
      }
      jwk = body.jwk;
    } catch (error) {
      return {
        ok: false,
        status: "unverifiable",
        reason: `could not fetch the key: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const data = Buffer.from(canonicalize(receiptPayload(receipt)), "utf8");
  const signature = base64UrlToBuffer(receipt.signature);

  try {
    const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
    const valid = nodeVerify(
      "sha256",
      data,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
    if (!valid) {
      return {
        ok: false,
        status: "invalid",
        reason: "signature does not match the payload — the receipt was altered or was signed by a different key",
      };
    }
    // Only now, with the signature proven, is it worth asking whether the receipt covers
    // the inputs the caller has in hand. Doing this earlier would let a forgery masquerade
    // as a mismatch, which is a less serious verdict than it deserves.
    const mismatched: Array<"request" | "policy"> = [];
    const checkDigest = async (expected: unknown, claimed: unknown, which: "request" | "policy") => {
      if (expected === undefined) return;
      if (typeof claimed !== "string") {
        mismatched.push(which);
        return;
      }
      const actual = await sha256Hex(expected);
      if (actual !== claimed) mismatched.push(which);
    };
    await checkDigest(options.expectedRequest, receipt.request_sha256, "request");
    await checkDigest(options.expectedPolicy, receipt.policy_sha256, "policy");

    if (mismatched.length > 0) {
      return {
        ok: false,
        status: "inputs-mismatch",
        reason: `signature is valid but the receipt does not cover the supplied ${mismatched.join(" and ")} input`,
        mismatched,
      };
    }

    if (options.maxAgeSeconds !== undefined) {
      const age = ageSeconds(receipt.issued_at, options.now);
      if (age === null) {
        // Garbage here is inside the signature: the issuer signed it, so it is the receipt
        // that is invalid, not the verifier's input.
        return {
          ok: false,
          status: "invalid",
          reason: `issued_at is not a parseable timestamp: ${JSON.stringify(receipt.issued_at)}`,
        };
      }
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
    return {
      ok: false,
      status: "invalid",
      reason: `could not verify: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
