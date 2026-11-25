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
 *  - Honest about provenance. `service.version` says which build produced the verdict, and
 *    falls back to "unknown" rather than "0.0.0", because a placeholder that looks like a
 *    version is read as one. It was "0.0.0" on every live receipt until 2026-11-12.
 */

import { paymentTermsDigest } from "@paystage/preflight";

export const RECEIPT_VERSION = 1;
export const RECEIPT_ALG = "ECDSA-P256-SHA256";
export const RECEIPT_KEY_ID = "paystage-receipt-v1";

/**
 * The explicit first-link marker for a hash chain (#171).
 *
 * `prev` is either this string or the SHA-256, lowercase hex, of the previous receipt's signed
 * payload for the same issuer. It is inside the payload and therefore inside the signature; a
 * verifier that only has one receipt never needs to resolve it.
 */
export const RECEIPT_CHAIN_GENESIS = "genesis";

const CHAIN_HASH = /^[0-9a-f]{64}$/;

/** The fields added after signing; everything else is the signed payload. */
const SIGNATURE_FIELDS = new Set(["signed", "alg", "key_id", "signature"]);

/**
 * The id of a receipt for chaining purposes: SHA-256 over its canonical signed payload.
 *
 * The signature is deliberately excluded: two receipts with the same payload are the same
 * accounting event, and a receipt id must not depend on how the signature was encoded. The
 * verifier computes the same value in `packages/mcp/src/verify.ts`; a parity test pins the two
 * implementations together.
 */
export async function receiptDigest(receipt: ReceiptPayload | Receipt): Promise<string> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(receipt)) {
    if (!SIGNATURE_FIELDS.has(key)) payload[key] = value;
  }
  return sha256Hex(payload);
}

function assertPrev(prev: string): string {
  if (prev !== RECEIPT_CHAIN_GENESIS && !CHAIN_HASH.test(prev)) {
    throw new Error(
      `prev must be "${RECEIPT_CHAIN_GENESIS}" or a lowercase 64-hex receipt digest, got ${JSON.stringify(prev)}`,
    );
  }
  return prev;
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

/**
 * The payment a receipt is about.
 *
 * A receipt used to say "a verdict was issued over this request digest". That is true and it is weaker than
 * it sounds: it cannot be shown to refer to *the* payment in front of you, and it never expires. Binding the
 * decision to the concrete payment terms — and giving it a lifetime — is what makes it checkable by someone
 * who was not there.
 */
export interface ReceiptPayment {
  scheme: string;
  network: string;
  asset: string;
  /** Atomic units as a string: 1000000 is 1.00 USDC at 6 decimals. */
  amount: string;
  payee: string;
}

export interface ReceiptPayload {
  v: number;
  issuer: string;
  issued_at: string;
  /** When this decision should no longer be acted on. Absent on receipts issued before v2. */
  expires_at?: string;
  service: { name: string; version: string };
  verdict: { decision: string; reasons: string[]; summary?: string };
  /** The payment terms this verdict was issued for. Absent on receipts issued before v2. */
  payment?: ReceiptPayment;
  /**
   * #443: the digest of the payment terms above, lowercase 64-hex without `0x`, signed inside the
   * payload. `@paystage/x402-guard/signer` refuses to produce a signature unless this equals the
   * digest it computes from the EIP-3009 typed data.
   *
   * It is the payment-**terms** digest (`paymentTermsDigest` in `@paystage/preflight`), not the
   * EIP-712 `hashTypedData` digest: the nonce, payer and validity window that EIP-712 covers are
   * not present in a 402 challenge, so a gate cannot know them before the client signs. See the
   * note in `packages/preflight/src/payment-digest.ts`.
   *
   * Optional so receipts issued before this field existed keep verifying. When present it is
   * inside the signature; a receipt whose field is stripped or altered fails verification.
   */
  payment_digest?: string;
  /**
   * The chain link (#171): the SHA-256 of the previous receipt this issuer produced, or
   * `"genesis"` for the first link. Absent on receipts issued before chaining existed, and on
   * issuers with no chain head — the verifier treats either as "pre-chain", not invalid.
   */
  prev?: string;
  request_sha256: string;
  policy_sha256: string;
}

/** Default lifetime: long enough for an agent to act, short enough that a stale allow is not a licence. */
export const RECEIPT_TTL_SECONDS = 300;

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
  /** The payment terms, when the caller knows them. Omitted receipts stay valid, just unbound. */
  payment?: ReceiptPayment;
  /** Override the default lifetime. Zero or negative disables the expiry stamp entirely. */
  ttlSeconds?: number;
  signingKeyPkcs8B64?: string | undefined;
  /**
   * Which signing key produced this receipt (#42). Rotation only works if each key stamps its own id: a receipt that
   * always says `paystage-receipt-v1` cannot be selected from a key set, and a verifier has to guess.
   */
  keyId?: string;
  /**
   * The chain head this receipt extends (#171): the digest of the previous receipt this issuer
   * produced, or `RECEIPT_CHAIN_GENESIS` for the first. Omitted means "not chained" — the
   * hosted Worker has no per-issuer head it can read, so it must not guess one; a stateful
   * issuer supplies the value from its stored head. See the note above `buildReceipt`.
   */
  prev?: string;
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
 * The digest, or `undefined` when the terms are not canonicalisable. A malformed amount is the only
 * realistic failure (the evaluator has already checked the other fields), and an absent field is
 * safer than aborting the verdict: a receipt must never be withheld because accounting could not
 * compute one value.
 */
async function safePaymentTermsDigest(payment: ReceiptPayment): Promise<string | undefined> {
  try {
    return await paymentTermsDigest(payment);
  } catch {
    return undefined;
  }
}

/**
 * Build a receipt for one decision. Signature failures degrade to an unsigned
 * receipt rather than failing the request: a verdict must never be withheld
 * because of an accounting problem.
 *
 * ## Chaining (#171)
 *
 * `prev` goes into the payload, so it is covered by the signature. The caller supplies it:
 * - first receipt for this issuer: `RECEIPT_CHAIN_GENESIS`;
 * - every receipt after: `await receiptDigest(previousReceipt)`.
 *
 * The per-issuer head is *not* stored here. A Cloudflare Worker isolate is not a safe place
 * for a monotonic head — two isolates can issue concurrently and neither can prove which came
 * first, and a database write per receipt would add a new dependency and a new failure mode to
 * the decision path. So the default is honest: with no `prev`, the receipt is pre-chain
 * (`prev` absent), and a chain verifier says it cannot prove that receipt extends anything.
 * A single receipt still verifies exactly as before. A stateful issuer (one process, or a
 * store with a real compare-and-swap head) passes `prev` explicitly; the hosted endpoint does
 * not, so live receipts from it must not be presented as an ordered chain.
 */
export async function buildReceipt(input: BuildReceiptInput): Promise<Receipt> {
  const issued = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? RECEIPT_TTL_SECONDS;
  const expires = ttl > 0 ? new Date(issued.getTime() + ttl * 1000).toISOString() : undefined;

  /**
   * #443: derive the digest from the same `payment` block the receipt publishes, never from a second
   * copy of the terms, so the field and the block cannot disagree. If the terms cannot be
   * canonicalised (a malformed amount), the field is omitted rather than filled with a placeholder:
   * an absent digest makes the adapter refuse, which is the honest fail-closed outcome, while a
   * fake one would make it refuse with a forgery-shaped reason.
   */
  const paymentDigest =
    input.payment === undefined ? undefined : await safePaymentTermsDigest(input.payment);

  const payload: ReceiptPayload = {
    v: RECEIPT_VERSION,
    issuer: "paystage",
    issued_at: issued.toISOString(),
    ...(expires === undefined ? {} : { expires_at: expires }),
    ...(input.payment === undefined ? {} : { payment: input.payment }),
    ...(paymentDigest === undefined ? {} : { payment_digest: paymentDigest }),
    ...(input.prev === undefined ? {} : { prev: assertPrev(input.prev) }),
    service: { name: "@paystage/hosted", version: input.serviceVersion ?? "unknown" },
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
      key_id: input.keyId ?? RECEIPT_KEY_ID,
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
