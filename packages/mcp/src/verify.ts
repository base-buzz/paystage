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

// globalThis.crypto exists in Workers and in Node 18+. Importing `webcrypto` from node:crypto
// works in Node and breaks the Worker bundle, which is the difference that matters here.
const webcrypto = globalThis.crypto;

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

/** The explicit first-link marker. Same literal the issuer writes (`RECEIPT_CHAIN_GENESIS`). */
export const CHAIN_GENESIS = "genesis";

const CHAIN_HASH = /^[0-9a-f]{64}$/;

/**
 * The id a receipt has inside a hash chain: SHA-256 over its canonical signed payload, any
 * signature fields excluded. Matches `receiptDigest` in `apps/hosted/src/receipt.ts`; a test
 * pins the two together so the issuer and verifier cannot drift.
 */
export async function receiptChainId(receipt: ReceiptLike): Promise<string> {
  return sha256Hex(receiptPayload(receipt));
}

/** Minimal JWK shape: the fields Web Crypto reads, no lib.dom dependency. */
type JsonWebKeyLike = { kty: string; crv?: string; x?: string; y?: string; n?: string; e?: string };

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
  /** Packets issued from v2 onward carry a lifetime; older ones simply never expire. */
  expires_at?: string;
  /** The payment terms this verdict was issued for, from v2 onward. */
  payment?: { scheme?: string; network?: string; asset?: string; amount?: string; payee?: string };
  /**
   * Chain link (#171): the digest of the previous receipt from this issuer, or `"genesis"`.
   * Absent means the receipt predates chaining, or its issuer had no stored chain head.
   */
  prev?: string;
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
  /**
   * The payment this receipt is being checked against.
   *
   * A receipt carries the terms it was issued for. Supplying the payment in front of you turns "a verdict
   * exists for this request" into "this verdict is about *this* payment" — the difference between a record and
   * an authorisation.
   */
  payment?: { scheme?: string; network?: string; asset?: string; amount?: string; payee?: string };
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
      status: "expired";
      reason: string;
      expires_at: string;
      expired_by_seconds: number;
    }
  | {
      ok: false;
      status: "payment-mismatch";
      reason: string;
      /** Which terms disagreed, so a caller can see whether it is the amount, the payee, or everything. */
      mismatched: string[];
    }
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
 * Resolve the verifying key, from the caller or the published document. Extracted from
 * `verifyReceipt` so a chain resolves each key id once instead of once per receipt.
 */
async function resolveKey(
  receipt: ReceiptLike,
  options: VerifyOptions,
): Promise<{ jwk: JwkLike } | { error: VerifyVerdict }> {
  const url = options.keyUrl ?? DEFAULT_KEY_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      return { error: { ok: false, status: "unverifiable", reason: `key endpoint returned ${res.status}` } };
    }
    // Two shapes: a JWKS (`{ keys: [...] }`, each with a `kid`) or the original single key (`{ jwk }`). The set is
    // what makes rotation additive — without it, publishing a new key silently invalidates every receipt signed by
    // the old one. Selection is by the `key_id` the receipt already carries, and a set that does not contain it is
    // `unverifiable` rather than a guess at which key was meant.
    const body = (await res.json()) as {
      configured?: boolean;
      jwk?: JwkLike;
      keys?: Array<JwkLike & { kid?: string }>;
    };
    const keys = body.keys ?? [];
    if (keys.length > 0) {
      const wanted = receipt.key_id;
      const match = wanted === undefined ? keys[0] : keys.find((k) => k.kid === wanted);
      if (match === undefined) {
        return {
          error: {
            ok: false,
            status: "unverifiable",
            reason: `the published key set has no key with kid ${String(wanted)} — the receipt names a key this issuer does not publish`,
          },
        };
      }
      return { jwk: match };
    }
    if (body.configured !== true || body.jwk === undefined) {
      return {
        error: {
          ok: false,
          status: "unverifiable",
          reason: "issuer has not published a signing key, so nothing can be checked",
        },
      };
    }
    return { jwk: body.jwk };
  } catch (error) {
    return {
      error: {
        ok: false,
        status: "unverifiable",
        reason: `could not fetch the key: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
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
    const found = await resolveKey(receipt, options);
    if ("error" in found) return found.error;
    jwk = found.jwk;
  }

  const data = new TextEncoder().encode(canonicalize(receiptPayload(receipt)));
  const signatureBuffer = base64UrlToBuffer(receipt.signature);
  const signature = new Uint8Array(
    signatureBuffer.buffer,
    signatureBuffer.byteOffset,
    signatureBuffer.byteLength,
  );

  try {
    // Web Crypto rather than node:crypto: identical verification, but it also runs in a Worker,
    // which is what lets the hosted endpoint expose `verify_receipt` at all. The JWK already names
    // the curve and hash, so the import is the whole setup.
    const publicKey = await webcrypto.subtle.importKey(
      "jwk",
      jwk as unknown as JsonWebKeyLike,
      { name: "ECDSA", namedCurve: String((jwk as { crv?: string }).crv ?? "P-256") },
      false,
      ["verify"],
    );
    const valid = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" } as Parameters<typeof webcrypto.subtle.verify>[0],
      publicKey,
      signature,
      data,
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

    // A signed receipt carries its own lifetime. Expiry is checked after the signature because an unsigned
    // receipt is already not trusted; an expired *signed* one is the case that matters.
    if (receipt.expires_at !== undefined) {
      const expiresAt = Date.parse(receipt.expires_at);
      const now = options.now ?? new Date();
      if (Number.isNaN(expiresAt)) {
        return {
          ok: false,
          status: "invalid",
          reason: `expires_at is not a parseable timestamp: ${JSON.stringify(receipt.expires_at)}`,
        };
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
        // An unbound receipt cannot be shown to be about this payment. That is not the same as wrong — say
        // which it is rather than letting it pass as a match.
        return {
          ok: false,
          status: "payment-mismatch",
          reason: "this receipt predates payment binding, so it cannot be shown to be about the supplied payment",
          mismatched: ["binding"],
        };
      }
      const mismatched = (["scheme", "network", "asset", "amount", "payee"] as const).filter((field) => {
        const wanted = options.payment?.[field];
        return wanted !== undefined && String(wanted) !== String(bound[field]);
      });
      if (mismatched.length > 0) {
        return {
          ok: false,
          status: "payment-mismatch",
          reason: `signature is valid but the receipt covers a different payment (${mismatched.join(", ")})`,
          mismatched,
        };
      }
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

/** One receipt's position and content id inside a chain verdict. */
export interface ChainReceiptRef {
  index: number;
  /** SHA-256 of the canonical signed payload — the value the next receipt's `prev` names. */
  id: string;
  issued_at?: string;
  key_id?: string;
}

/**
 * The result of walking a list of receipts.
 *
 * Status strings are new and separate from `VerifyVerdict`: `verifyReceipt` keeps returning
 * exactly the same values for a single receipt. "The chain has a gap" is not "this receipt is
 * forged", and collapsing them would repeat the mistake the single-receipt vocabulary avoids.
 */
export type ChainVerdict =
  | {
      ok: true;
      status: "chain-valid";
      count: number;
      head: "genesis" | "pre-chain";
      /** False for a pre-chain head: the chain cannot prove what came before it. */
      anchored: boolean;
      receipts: ChainReceiptRef[];
      note: string;
    }
  | {
      ok: false;
      status: "chain-gap";
      reason: string;
      /** Index of the first receipt that does not extend the one at `index - 1`. */
      index: number;
      /** The receipt before the gap, or null when the gap is at the head. */
      previous: ChainReceiptRef | null;
      /** The receipt after the gap — the one whose `prev` did not match. */
      next: ChainReceiptRef;
      /** What the link should have been: the previous receipt id, or `genesis` at the head. */
      expected_prev: string;
      /** What the receipt actually claims. */
      actual_prev: string | null;
      /** The id of the receipt that is missing, when the claim names a real digest. */
      missing_receipt_id?: string;
      note: string;
    }
  | {
      ok: false;
      status: "chain-invalid";
      reason: string;
      index: number;
      receipt: ChainReceiptRef;
      receipt_verdict: VerifyVerdict;
    }
  | { ok: false; status: "chain-empty"; reason: string };

const CHAIN_LIMIT_NOTE =
  "A hash chain proves no interior receipt was removed from this list. It cannot, by itself, prove the first or last entry is the real start or end of the issuer's history: that needs the head or tail committed somewhere outside the list.";

/**
 * Walk a list of receipts and report the first break.
 *
 * - Every receipt is verified individually first, with the same verifier a single receipt uses.
 * - The first receipt must be `prev: "genesis"` or pre-chain (no `prev`). A first receipt that
 *   names a hash is a gap at index 0: the receipt it extends is not in the list.
 * - Each later receipt must name the previous receipt's id. A missing `prev` mid-list is a gap,
 *   not "pre-chain" — the receipt sits after another one and cannot be shown to extend it.
 * - A receipt whose `prev` was edited after signing fails its signature and is `chain-invalid`
 *   at that index; a correctly signed receipt that names the wrong predecessor is a `chain-gap`.
 */
export async function verifyReceiptChain(
  receipts: ReceiptLike[],
  options: VerifyOptions = {},
): Promise<ChainVerdict> {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return { ok: false, status: "chain-empty", reason: "no receipts to walk — the chain is empty" };
  }

  const refs: ChainReceiptRef[] = [];
  const keyCache = new Map<string, JwkLike>();

  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
      const ref: ChainReceiptRef = { index, id: "(unreadable)" };
      return {
        ok: false,
        status: "chain-invalid",
        reason: `receipt at index ${index} is not an object`,
        index,
        receipt: ref,
        receipt_verdict: { ok: false, status: "invalid", reason: "receipt is not an object" },
      };
    }

    const id = await receiptChainId(receipt);
    const ref: ChainReceiptRef = {
      index,
      id,
      ...(receipt.issued_at === undefined ? {} : { issued_at: receipt.issued_at }),
      ...(receipt.key_id === undefined ? {} : { key_id: receipt.key_id }),
    };

    // Resolve each key id once. A rotated key must still select by `key_id`, so the cache is
    // keyed by it rather than by "the one key".
    let jwk = options.jwk;
    if (jwk === undefined) {
      const cacheKey = receipt.key_id ?? "";
      const cached = keyCache.get(cacheKey);
      if (cached !== undefined) {
        jwk = cached;
      } else {
        const found = await resolveKey(receipt, options);
        if ("error" in found) {
          const keyError = found.error;
          return {
            ok: false,
            status: "chain-invalid",
            reason: `could not verify receipt at index ${index}: ${keyError.ok ? "key unavailable" : keyError.reason}`,
            index,
            receipt: ref,
            receipt_verdict: keyError,
          };
        }
        jwk = found.jwk;
        keyCache.set(cacheKey, jwk);
      }
    }

    const verdict = await verifyReceipt(receipt, { ...options, jwk });
    if (!verdict.ok) {
      return {
        ok: false,
        status: "chain-invalid",
        reason: `receipt at index ${index} is not a valid receipt: ${verdict.reason}`,
        index,
        receipt: ref,
        receipt_verdict: verdict,
      };
    }
    refs.push(ref);

    const prev = typeof receipt.prev === "string" ? receipt.prev : undefined;

    if (index === 0) {
      if (prev !== undefined && prev !== CHAIN_GENESIS) {
        const malformed = !CHAIN_HASH.test(prev);
        return {
          ok: false,
          status: "chain-gap",
          reason: malformed
            ? `receipt at index 0 has a malformed prev (${JSON.stringify(prev)}); expected "genesis" or a 64-hex digest`
            : `chain does not start at genesis: receipt 0 extends ${prev}, so at least one earlier receipt is missing from this list`,
          index: 0,
          previous: null,
          next: ref,
          expected_prev: CHAIN_GENESIS,
          actual_prev: prev,
          ...(malformed ? {} : { missing_receipt_id: prev }),
          note: CHAIN_LIMIT_NOTE,
        };
      }
      continue;
    }

    const previous = refs[index - 1];
    if (prev === undefined) {
      return {
        ok: false,
        status: "chain-gap",
        reason: `receipt at index ${index} has no prev, so it cannot be shown to extend the receipt at index ${index - 1} — it is a pre-chain receipt inside a chain`,
        index,
        previous,
        next: ref,
        expected_prev: previous.id,
        actual_prev: null,
        missing_receipt_id: previous.id,
        note: CHAIN_LIMIT_NOTE,
      };
    }
    if (prev !== previous.id) {
      return {
        ok: false,
        status: "chain-gap",
        reason: `receipt at index ${index} does not extend the receipt at index ${index - 1}: expected prev ${previous.id}, got ${prev}`,
        index,
        previous,
        next: ref,
        expected_prev: previous.id,
        actual_prev: prev,
        ...(CHAIN_HASH.test(prev) ? { missing_receipt_id: prev } : {}),
        note: CHAIN_LIMIT_NOTE,
      };
    }
  }

  const head = refs[0].id;
  const first = receipts[0];
  const firstPrev = typeof first.prev === "string" ? first.prev : undefined;
  const headKind: "genesis" | "pre-chain" = firstPrev === CHAIN_GENESIS ? "genesis" : "pre-chain";
  return {
    ok: true,
    status: "chain-valid",
    count: refs.length,
    head: headKind,
    anchored: firstPrev === CHAIN_GENESIS,
    receipts: refs,
    note:
      headKind === "pre-chain"
        ? `The first receipt is pre-chain (no prev), so this chain proves links from ${head} forward but not that it is the issuer's first receipt. ${CHAIN_LIMIT_NOTE}`
        : CHAIN_LIMIT_NOTE,
  };
}
