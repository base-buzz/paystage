/**
 * Receipt lifecycle (#413): authorised → captured → voided → refunded, signed at each step.
 *
 * ## Why a separate signed statement rather than a `lifecycle` array inside the receipt
 *
 * A receipt is signed once. Appending a `lifecycle` event after signing would change the payload the
 * signature covers, so either the signature stops verifying or the receipt has to be re-signed — and
 * re-signing produces a new digest, which destroys the very anchor a refund must point at. Events
 * therefore travel as separate signed statements that name the original receipt by digest.
 *
 * They are not a second envelope. Each statement is the receipt envelope exactly: every field except
 * `signed`, `alg`, `key_id` and `signature` is the canonical payload, ES256 over those canonical
 * bytes, base64url raw `r||s`, selected by the published `key_id`. `verifyChain()` verifies every
 * link by calling the existing `verifyReceipt()` — that function is deliberately unchanged, because
 * a lifecycle that needed the verifier edited into a second format would be the failure this row
 * forbids. The original receipt is never modified, so a receipt with no lifecycle still verifies
 * exactly as before.
 *
 * The lifecycle is a **state machine with signed transitions, not a bag of events**. The settled
 * receipt anchors `captured`; statements then move the state in one legal direction, and the verifier
 * refuses an out-of-order chain instead of trusting the caller to have sorted it. The illegal orders
 * that matter are tested: `voided` cannot follow `refunded`, and a refund cannot precede a capture.
 */

import {
  RECEIPT_ALG,
  canonicalize,
  receiptPayload,
  verifyReceipt,
  type JwkLike,
  type ReceiptLike,
} from "./verify.js";

const webcrypto = globalThis.crypto;

/** The statement type, so a signature over some other receipt-shaped object cannot pass as a transition. */
export const LIFECYCLE_KIND = "paystage.receipt-lifecycle.v1";

/** The four states the row names, in the order they may occur. */
export const LIFECYCLE_STATES = ["authorised", "captured", "voided", "refunded"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** The default `key_id`: the receipt key, reused rather than rotated in. */
export const LIFECYCLE_KEY_ID = "paystage-receipt-v1";

const DIGEST_RE = /^[0-9a-f]{64}$/;
const ATOMIC_RE = /^[0-9]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalize(value));
  return toHex(await webcrypto.subtle.digest("SHA-256", bytes));
}

/**
 * The id a refund points at: SHA-256 over the receipt's canonical signed payload.
 *
 * This is the same value `apps/hosted/src/receipt.ts` calls `receiptDigest()` and the same one the
 * chain link `prev` carries: the signature fields are excluded, so a receipt id does not depend on
 * how its signature was encoded. Computed from the verifier's own `receiptPayload()`, so it cannot
 * drift from what `verifyReceipt()` checks.
 */
export async function receiptDigest(receipt: ReceiptLike): Promise<string> {
  return sha256Hex(canonicalize(receiptPayload(receipt)));
}

/** The signed body of one transition. Everything except `signed`, `alg`, `key_id` and `signature`. */
export interface LifecycleEventBody {
  v: 1;
  kind: typeof LIFECYCLE_KIND;
  state: LifecycleState;
  /** ISO 8601 instant this transition was signed. */
  at: string;
  /** Digest of the original settled receipt this statement is about. */
  receipt: string;
  /**
   * Atomic units as a string, the same unit as `ReceiptPayment.amount` (`"400000"` is 0.40 USDC at
   * six decimals). Required for `refunded`; optional evidence on the other states.
   */
  amount?: string;
  /** Human-readable reason (partial delivery, damaged goods, …). Never trusted for arithmetic. */
  reason?: string;
}

/** A signed transition: the receipt envelope around a lifecycle body. */
export interface LifecycleEvent extends LifecycleEventBody {
  signed: true;
  alg: typeof RECEIPT_ALG;
  key_id: string;
  signature: string;
}

export interface IssueLifecycleInput {
  state: LifecycleState;
  /** Atomic units, positive integer string. Required when `state` is `refunded`. */
  amount?: string;
  reason?: string;
  /** Defaults to the supplied clock (`now`, or wall time). */
  at?: string | Date;
}

export interface IssueLifecycleOptions {
  /** The receipt signing key, PKCS#8 base64 — the same key format the receipt builder takes. */
  signingKeyPkcs8B64?: string;
  /** Override the published key id. Rotation is additive, so the id is stamped rather than assumed. */
  kid?: string;
  /** Injectable clock, so tests do not depend on wall time. */
  now?: Date;
  /** Test seam for an in-process key; production callers pass `signingKeyPkcs8B64`. */
  privateKey?: CryptoKey;
}

function positiveAtomic(value: unknown, field: string): string | null {
  if (typeof value !== "string" || !ATOMIC_RE.test(value)) {
    return `${field} is not an atomic-unit integer string: ${JSON.stringify(value)}`;
  }
  if (BigInt(value) <= 0n) return `${field} must be greater than zero: ${JSON.stringify(value)}`;
  return null;
}

function toIso(value: string | Date | undefined, fallback: Date): string {
  const date = value === undefined ? fallback : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`not a parseable timestamp: ${JSON.stringify(value)}`);
  return date.toISOString();
}

async function importSigningKey(pkcs8B64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(pkcs8B64), (ch) => ch.charCodeAt(0));
  return webcrypto.subtle.importKey("pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/**
 * Sign one transition against a receipt.
 *
 * Throws on invalid input, exactly as `issue()` in `@paystage/mandate` does: an issuer that cannot
 * describe the transition must not fall back to an unsigned statement. Verification never throws.
 */
export async function issueLifecycle(
  receipt: ReceiptLike,
  input: IssueLifecycleInput,
  options: IssueLifecycleOptions = {},
): Promise<LifecycleEvent> {
  if (!isRecord(receipt)) throw new Error("issueLifecycle() needs the original receipt object");
  if (!LIFECYCLE_STATES.includes(input.state)) {
    throw new Error(`unknown lifecycle state ${JSON.stringify(input.state)}`);
  }
  if (input.state === "refunded" && input.amount === undefined) {
    throw new Error("a refunded statement must carry an amount");
  }
  if (input.amount !== undefined) {
    const amountError = positiveAtomic(input.amount, "amount");
    if (amountError !== null) throw new Error(amountError);
  }
  if (input.reason !== undefined && typeof input.reason !== "string") throw new Error("reason must be a string");
  if (options.privateKey === undefined && !options.signingKeyPkcs8B64) {
    throw new Error("issueLifecycle() needs a signing key: pass signingKeyPkcs8B64 (or privateKey in tests)");
  }

  const payload: LifecycleEventBody = {
    v: 1,
    kind: LIFECYCLE_KIND,
    state: input.state,
    at: toIso(input.at, options.now ?? new Date()),
    receipt: await receiptDigest(receipt),
    ...(input.amount === undefined ? {} : { amount: input.amount }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };

  const key = options.privateKey ?? (await importSigningKey(options.signingKeyPkcs8B64 as string));
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(canonicalize(payload)),
  );
  return {
    ...payload,
    signed: true,
    alg: RECEIPT_ALG,
    key_id: options.kid ?? LIFECYCLE_KEY_ID,
    signature: base64Url(signature),
  };
}

export interface RefundInput {
  /** Atomic units, positive integer string, no greater than what remains captured. */
  amount: string;
  reason?: string;
  at?: string | Date;
}

/**
 * Record a refund. This is the first-class operation the row asks for: it names the original receipt
 * and an amount, and the arithmetic is checked by `verifyChain()`, not left to the caller.
 */
export async function refund(
  receipt: ReceiptLike,
  input: RefundInput,
  options: IssueLifecycleOptions = {},
): Promise<LifecycleEvent> {
  return issueLifecycle(receipt, { state: "refunded", amount: input.amount, reason: input.reason, at: input.at }, options);
}

export interface LifecycleKeyOptions {
  /** A single published key. If it carries a `kid`, it must match the statement's `key_id`. */
  jwk?: JwkLike;
  /** A published key set, selected by `key_id` (the receipt JWKS shape). */
  keys?: readonly JwkLike[];
}

function selectKey(keyId: string, options: LifecycleKeyOptions): JwkLike | undefined {
  if (options.jwk !== undefined) {
    if (options.jwk.kid !== undefined && String(options.jwk.kid) !== keyId) return undefined;
    return options.jwk;
  }
  const keys = options.keys ?? [];
  return keys.find((key) => key.kid === keyId) ?? (keys.length === 1 && keys[0].kid === undefined ? keys[0] : undefined);
}

export type LifecycleEventStatus = "unsigned" | "tampered" | "malformed";

export type LifecycleEventVerification =
  | { ok: true; event: LifecycleEvent }
  | { ok: false; status: LifecycleEventStatus; reason: string };

function validateEventBody(value: Record<string, unknown>): string | null {
  if (value.v !== 1) return `unsupported lifecycle version ${JSON.stringify(value.v)} (this verifier understands 1)`;
  if (value.kind !== LIFECYCLE_KIND) {
    return `not a lifecycle statement: kind is ${JSON.stringify(value.kind)}, expected ${JSON.stringify(LIFECYCLE_KIND)}`;
  }
  if (!LIFECYCLE_STATES.includes(value.state as LifecycleState)) {
    return `unknown lifecycle state ${JSON.stringify(value.state)}`;
  }
  if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) {
    return `at is not a parseable timestamp: ${JSON.stringify(value.at)}`;
  }
  if (typeof value.receipt !== "string" || !DIGEST_RE.test(value.receipt)) {
    return `receipt is not a lowercase 64-hex receipt digest: ${JSON.stringify(value.receipt)}`;
  }
  if (value.amount !== undefined) {
    const amountError = positiveAtomic(value.amount, "amount");
    if (amountError !== null) return amountError;
  }
  if (value.state === "refunded" && value.amount === undefined) return "a refunded statement carries no amount";
  if (value.reason !== undefined && typeof value.reason !== "string") return "reason is not a string";
  return null;
}

/**
 * Check one lifecycle statement with the existing receipt verifier. Never throws; an unverifiable
 * statement is reported as `unsigned`, never as valid.
 */
export async function verifyLifecycleEvent(
  event: unknown,
  options: LifecycleKeyOptions = {},
): Promise<LifecycleEventVerification> {
  if (!isRecord(event)) return { ok: false, status: "malformed", reason: "lifecycle statement is not an object" };
  if (event.signed !== true || typeof event.signature !== "string" || event.signature.length === 0) {
    return {
      ok: false,
      status: "unsigned",
      reason: "lifecycle statement carries no signature — it records what someone wrote, but cannot prove a transition",
    };
  }
  if (typeof event.key_id !== "string" || event.key_id.trim() === "") {
    return { ok: false, status: "malformed", reason: "lifecycle statement names no key_id" };
  }
  const jwk = selectKey(event.key_id, options);
  if (jwk === undefined) {
    return {
      ok: false,
      status: "unsigned",
      reason: `the supplied key set has no key with key_id ${JSON.stringify(event.key_id)}, so the signature cannot be checked`,
    };
  }
  const checked = await verifyReceipt(event as unknown as ReceiptLike, { jwk });
  if (!checked.ok) {
    return {
      ok: false,
      status: checked.status === "unsigned" ? "unsigned" : "tampered",
      reason: checked.reason,
    };
  }
  const bodyError = validateEventBody(event);
  if (bodyError !== null) return { ok: false, status: "malformed", reason: bodyError };
  return { ok: true, event: event as unknown as LifecycleEvent };
}

/** The receipt that anchors a chain: the settled payment, whose amount is what refunds draw from. */
export interface ChainPayment {
  /** The original receipt, exactly as issued. Never modified by a lifecycle transition. */
  receipt: ReceiptLike;
  /** Statements already known for this receipt, in chain order. `verifyChain`'s second argument overrides. */
  lifecycle?: readonly unknown[];
}

/**
 * Key selection only. The chain deliberately has no clock option: a receipt's `expires_at` bounds
 * acting on the *decision*, not refunding a payment that already settled, so `verifyChain()` checks
 * authenticity and arithmetic rather than freshness. A caller whose policy needs a fresh receipt can
 * ask `verifyReceipt()` separately.
 */
export type VerifyChainOptions = LifecycleKeyOptions;

/** Every way a lifecycle chain can fail, named by the link that broke rather than by a generic "invalid". */
export type ChainFailureStatus =
  | "missing-original"
  | "unsigned"
  | "tampered"
  | "malformed"
  | "illegal-transition"
  | "amount-exceeds-captured"
  | "already-refunded";

export type ChainVerification =
  | {
      ok: true;
      /** Atomic units, string: the original receipt's payment amount. */
      captured: string;
      /** Atomic units, string: the sum of every accepted refunded statement. */
      refunded: string;
      /** Atomic units, string: `captured - refunded`. */
      remaining: string;
      /** The state the chain ended in. `captured` means no transition statement was accepted. */
      state: LifecycleState;
    }
  | { ok: false; status: ChainFailureStatus; reason: string; /** Index of the statement that broke, when there is one. */ link?: number };

/**
 * Check a payment and its whole refund chain offline: the original receipt, every transition, the
 * legal order, and the arithmetic.
 *
 * The receipt anchors `captured`. Statements then move the state through the machine:
 *
 *   captured --refunded--> refunded --refunded--> refunded (partial, until remaining is zero)
 *   captured --voided----> voided ----refunded--> refunded
 *   (authorised) must precede the receipt's capture time and is evidence only
 *
 * `voided` after `refunded` is refused (`illegal-transition`), as is a refund whose `at` is earlier
 * than the receipt's `issued_at` — a refund cannot precede a capture. A refund larger than what
 * remains is `amount-exceeds-captured`; any refund once `remaining` is zero is `already-refunded`.
 */
export async function verifyChain(
  payment: ChainPayment,
  statements: readonly unknown[] = payment?.lifecycle ?? [],
  options: VerifyChainOptions = {},
): Promise<ChainVerification> {
  if (!isRecord(payment) || payment.receipt === null || typeof payment.receipt !== "object") {
    return { ok: false, status: "missing-original", reason: "no original receipt was supplied, so there is nothing to refund against" };
  }
  const receipt = payment.receipt as ReceiptLike;
  const issuedAt = typeof receipt.issued_at === "string" ? Date.parse(receipt.issued_at) : Number.NaN;
  if (Number.isNaN(issuedAt)) {
    return { ok: false, status: "malformed", reason: `the original receipt has no parseable issued_at: ${JSON.stringify(receipt.issued_at)}` };
  }
  const keyId = typeof receipt.key_id === "string" ? receipt.key_id : "";
  const receiptKey = keyId === "" ? undefined : selectKey(keyId, options);
  if (receiptKey === undefined) {
    return {
      ok: false,
      status: "unsigned",
      reason: "the original receipt names no key_id, or the supplied key set has no such key, so its capture cannot be proven",
    };
  }
  /**
   * Pin the verifier's clock to the receipt's own issue time. `expires_at` says how long a *decision*
   * may be acted on; it says nothing about whether a settled payment may be refunded next week.
   * Pinning keeps a genuine, signed capture from being reported as `expired` when the refund arrives
   * — the check here is authenticity plus arithmetic, not freshness.
   */
  const check = await verifyReceipt(receipt, { jwk: receiptKey, now: new Date(issuedAt) });
  if (!check.ok) {
    return {
      ok: false,
      status: check.status === "unsigned" ? "unsigned" : "tampered",
      reason: `the original receipt does not verify: ${check.reason}`,
    };
  }

  const amount = receipt.payment?.amount;
  if (typeof amount !== "string" || !ATOMIC_RE.test(amount) || BigInt(amount) <= 0n) {
    return {
      ok: false,
      status: "malformed",
      reason: `the original receipt carries no usable atomic-unit payment amount (${JSON.stringify(amount)}), so refund arithmetic cannot be checked`,
    };
  }
  const captured = BigInt(amount);
  const original = await receiptDigest(receipt);

  let state: LifecycleState = "captured";
  let refunded = 0n;
  let sawAuthorised = false;
  let sawCaptured = false;
  let sawVoided = false;
  let lastAt: number | undefined;

  for (let index = 0; index < statements.length; index += 1) {
    const checked = await verifyLifecycleEvent(statements[index], options);
    if (!checked.ok) {
      return { ok: false, status: checked.status, reason: `lifecycle statement ${index}: ${checked.reason}`, link: index };
    }
    const event = checked.event;
    if (event.receipt !== original) {
      return {
        ok: false,
        status: "missing-original",
        reason: `lifecycle statement ${index} points at receipt ${event.receipt}, not the supplied receipt ${original}`,
        link: index,
      };
    }

    const at = Date.parse(event.at);
    if (lastAt !== undefined && at < lastAt) {
      return {
        ok: false,
        status: "illegal-transition",
        reason: `lifecycle statement ${index} is older than the statement before it; a chain is ordered in time, so reordering it must not be possible`,
        link: index,
      };
    }
    lastAt = at;

    switch (event.state) {
      case "authorised": {
        if (sawAuthorised || index !== 0) {
          return {
            ok: false,
            status: "illegal-transition",
            reason: `lifecycle statement ${index} records an authorisation after the chain has started; authorisation must be the first statement`,
            link: index,
          };
        }
        if (at > issuedAt) {
          return {
            ok: false,
            status: "illegal-transition",
            reason: `lifecycle statement ${index} authorises the payment at ${event.at}, after the receipt captured it at ${String(receipt.issued_at)} — authorisation cannot follow capture`,
            link: index,
          };
        }
        sawAuthorised = true;
        break;
      }
      case "captured": {
        if (sawCaptured) {
          return { ok: false, status: "illegal-transition", reason: `lifecycle statement ${index} captures a payment already captured`, link: index };
        }
        if (state === "voided" || state === "refunded") {
          return {
            ok: false,
            status: "illegal-transition",
            reason: `lifecycle statement ${index} captures after the payment was ${state}`,
            link: index,
          };
        }
        if (at < issuedAt) {
          return {
            ok: false,
            status: "illegal-transition",
            reason: `lifecycle statement ${index} captures the payment at ${event.at}, before the receipt was issued at ${String(receipt.issued_at)}`,
            link: index,
          };
        }
        if (event.amount !== undefined && BigInt(event.amount) !== captured) {
          return {
            ok: false,
            status: "malformed",
            reason: `lifecycle statement ${index} captures ${event.amount} atomic units, but the receipt captured ${amount}`,
            link: index,
          };
        }
        sawCaptured = true;
        break;
      }
      case "voided": {
        if (state === "refunded") {
          return {
            ok: false,
            status: "illegal-transition",
            reason: `lifecycle statement ${index} voids a payment that was already refunded — voided cannot follow refunded`,
            link: index,
          };
        }
        if (sawVoided) {
          return { ok: false, status: "illegal-transition", reason: `lifecycle statement ${index} voids a payment already voided`, link: index };
        }
        if (at < issuedAt) {
          return {
            ok: false,
            status: "illegal-transition",
            reason: `lifecycle statement ${index} voids the payment at ${event.at}, before the receipt captured it at ${String(receipt.issued_at)}`,
            link: index,
          };
        }
        sawVoided = true;
        state = "voided";
        break;
      }
      case "refunded": {
        if (at < issuedAt) {
          return {
            ok: false,
            status: "illegal-transition",
            reason: `lifecycle statement ${index} refunds at ${event.at}, before the receipt captured the payment at ${String(receipt.issued_at)} — a refund cannot precede a capture`,
            link: index,
          };
        }
        const width = BigInt(event.amount as string);
        const remaining = captured - refunded;
        if (remaining === 0n) {
          return {
            ok: false,
            status: "already-refunded",
            reason: `lifecycle statement ${index} refunds ${event.amount} atomic units, but the whole captured ${amount} has already been refunded`,
            link: index,
          };
        }
        if (width > remaining) {
          return {
            ok: false,
            status: "amount-exceeds-captured",
            reason: `lifecycle statement ${index} refunds ${event.amount} atomic units, more than the ${remaining} still captured (captured ${amount}, refunded ${refunded})`,
            link: index,
          };
        }
        refunded += width;
        state = "refunded";
        break;
      }
    }
  }

  return {
    ok: true,
    captured: captured.toString(),
    refunded: refunded.toString(),
    remaining: (captured - refunded).toString(),
    state,
  };
}
