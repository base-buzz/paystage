/**
 * Challenge idempotency (#444) — a retried preflight is not a second approval.
 *
 * ## Why the key is a canonical digest of the challenge, not the receipt's `payment_digest`
 *
 * #425's signer adapter binds a signature to the payment it approves; since #443 that binding is a
 * digest of the five payment terms (`scheme`, `network`, `asset`, `amount`, `payee`), not the
 * EIP-712 typed-data digest, because the nonce/payer/validity fields are chosen at signing time. It
 * is still not a challenge key: it says nothing about the resource, the timeout or the accept's
 * `extra`, and a retry that times out *before signing* has no signed payment to digest at all.
 * So the key this module uses is the canonical digest of the challenge the verdict was issued for,
 * which is the only payment-shaped thing that exists on both the first call and the retry.
 *
 * The digest covers the **whole payment request** — `x402Version`, every accept (including
 * `extra`) and the resource. It is never just the payee, and it must not be "optimised" down to
 * one: a digest over the payee alone would let a changed amount reuse the earlier `pay`, which is
 * the exact duplicate-authorisation this row exists to stop. A different amount is a different
 * digest by construction, so a changed challenge is evaluated as a new decision.
 *
 * ## The store is injected and bounded
 *
 * The evaluator package is a library inside someone else's process, so it cannot promise durable
 * state. `ChallengeVerdictStore` is the host's seam, like `PayerFirstSeenStore` (#409):
 * `evaluateWithChallengeIdempotency()` looks a verdict up before evaluating and remembers a fresh
 * one after. Hosts pass an in-memory store (`createMemoryChallengeVerdictStore()`, TTL and entry
 * cap) or their own durable implementation.
 *
 * If the store is absent, the lookup throws, the salt is missing, or the write fails, the payment
 * is still evaluated and returned — the repeat check degrades to "not checked" with a **named**
 * reason on `repeat_check`, never silently and never as a refusal.
 */

import type { Policy } from "@paystage/policy";
import { sha256Hex } from "./evidence.js";
import {
  evaluatePayment,
  type EvaluateOptions,
  type EvaluateResult,
  type PaymentRequest,
  type RepeatCheck,
} from "./evaluate.js";

/** Ten minutes: long enough for an agent's retry loop, short enough that a rebuy is a new decision. */
export const DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** A hard cap on the in-memory reference store. A TTL alone is not a bound under load. */
export const DEFAULT_CHALLENGE_MAX_ENTRIES = 1_024;

/** Domain separation, so a key derived here cannot collide with another use of the same salt. */
const KEY_DOMAIN = "paystage.challenge-verdict.v1";

/** The only shape a salted key may have: lowercase hex SHA-256 output. */
const SALTED_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Stable tokens for `RepeatCheck.reason`. Exported so a caller/tests bind to the token, not a
 * sentence that can be reworded.
 */
export const REPEAT_REASON = {
  firstSight: "first_sight",
  repeat: "repeat",
  storeAbsent: "challenge_store_absent",
  storeUnreadable: "challenge_store_unreadable",
  storeWriteFailed: "challenge_store_write_failed",
  saltMissing: "challenge_salt_missing",
  digestUnavailable: "challenge_digest_unavailable",
} as const;

/**
 * The canonical digest of a challenge: SHA-256 over the repo's canonical JSON (sorted keys, no
 * insignificant whitespace), lowercase 64-hex without `0x`.
 *
 * `error` is deliberately excluded: it is the seller's human-readable sentence, not a payment
 * term. A retry whose 402 body rewords its error but keeps the same payment is the same payment;
 * changing any accept field or the resource is not.
 *
 * Uses `sha256Hex` from `./evidence.ts` — the same canonicalisation the receipt and evidence
 * bundle already use — so there is no second JSON canonicaliser in this package.
 */
export async function challengeDigest(pr: PaymentRequest): Promise<string> {
  const candidate = (pr ?? {}) as Partial<PaymentRequest>;
  return sha256Hex({
    x402Version: candidate.x402Version,
    accepts: candidate.accepts,
    resource: candidate.resource,
  });
}

/**
 * Derive the stored key from a repeat key and the operator's salt.
 *
 * `HMAC-SHA-256(salt, "paystage.challenge-verdict.v1\0" + repeatKey)`. The store therefore never
 * holds the repeat key itself, and two stores written with different salts cannot be joined.
 * A missing salt is an error rather than an unsalted key: an unsalted digest of a payment is
 * recomputable by anyone who can see the 402 body, which removes the point of the salt.
 */
export async function deriveChallengeKey(repeatKey: string, salt: string): Promise<string> {
  if (typeof repeatKey !== "string" || repeatKey.length === 0) {
    throw new Error("repeat key is required");
  }
  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("challenge-verdict salt is required; supply it from deployment configuration");
  }
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Web Crypto is unavailable, so a salted challenge key cannot be derived");
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${KEY_DOMAIN}\u0000${repeatKey}`),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One stored verdict: the original result and the instant it was issued. */
export interface ChallengeVerdictRecord {
  /** The original `evaluatePayment()` result, without repeat markers. */
  verdict: EvaluateResult;
  /** ISO 8601 instant of the original verdict. Returned as `as_of` on a repeat. */
  as_of: string;
}

/**
 * The injected store.
 *
 * Keys are **already salted** by {@link deriveChallengeKey}; an implementation must treat them as
 * opaque and must never persist a raw digest or repeat key. It must also be bounded: expire rows
 * after a TTL and cap the number it keeps. `createMemoryChallengeVerdictStore()` is the reference
 * implementation for a single process and for tests; a durable host supplies its own.
 */
export interface ChallengeVerdictStore {
  /** The record for a salted key, or `null`. Throwing means "could not answer", not "no record". */
  lookup(key: string): Promise<ChallengeVerdictRecord | null>;
  /** Store one record under a salted key. Throwing is reported, never fatal to the payment. */
  remember(key: string, record: ChallengeVerdictRecord): Promise<void>;
}

export interface MemoryChallengeVerdictStoreOptions {
  /** How long a record stays eligible for a repeat. Default {@link DEFAULT_CHALLENGE_TTL_MS}. */
  ttlMs?: number;
  /** Maximum records kept; the oldest is evicted first. Default {@link DEFAULT_CHALLENGE_MAX_ENTRIES}. */
  maxEntries?: number;
  /** Injectable clock so expiry tests do not sleep. */
  now?: () => Date;
}

/**
 * A bounded, process-local reference store.
 *
 * It receives salted keys, so it contains no salt and cannot be configured to store raw digests.
 * Expiry is lazy (on lookup/remember) and the entry cap is enforced on every write, so it cannot
 * grow without bound even if every key is unique.
 */
export function createMemoryChallengeVerdictStore(
  options: MemoryChallengeVerdictStoreOptions = {},
): ChallengeVerdictStore {
  const ttlMs = options.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("challenge store ttlMs must be a positive number");
  }
  const maxEntries = options.maxEntries ?? DEFAULT_CHALLENGE_MAX_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("challenge store maxEntries must be a positive integer");
  }
  const now = options.now ?? (() => new Date());
  const entries = new Map<string, { record: ChallengeVerdictRecord; expiresAt: number }>();

  const prune = (at: number): void => {
    for (const [key, row] of entries) {
      if (row.expiresAt <= at) entries.delete(key);
    }
  };

  return {
    async lookup(key: string): Promise<ChallengeVerdictRecord | null> {
      if (!SALTED_KEY_RE.test(key)) return null;
      const at = now().getTime();
      prune(at);
      return entries.get(key)?.record ?? null;
    },

    async remember(key: string, record: ChallengeVerdictRecord): Promise<void> {
      if (!SALTED_KEY_RE.test(key)) {
        throw new Error("challenge store key must be the salted 64-hex key from deriveChallengeKey");
      }
      const at = now().getTime();
      prune(at);
      entries.set(key, { record, expiresAt: at + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

export interface ChallengeIdempotencyOptions extends EvaluateOptions {
  /**
   * The host's verdict store. Absence is not an error: the result says
   * `repeat_check.reason = "challenge_store_absent"` and the evaluation is today's stateless one.
   */
  challengeStore?: ChallengeVerdictStore;
  /**
   * The deployment salt used to derive stored keys. Required whenever `challengeStore` is set;
   * a store without a salt degrades with `challenge_salt_missing` rather than writing raw keys.
   */
  challengeSalt?: string;
}

/**
 * The scope a stored verdict belongs to.
 *
 * The same 402 challenge can be judged differently under a different policy, agent, catalogue
 * claim, mandate, payer history or client identifier. Keying only on the challenge would hand agent
 * A's verdict to agent B, so the repeat key binds the challenge digest to every decision input the
 * evaluator reads. `now` is deliberately excluded: a repeat inside the TTL is the *same* verdict,
 * not a re-evaluation at the new hour.
 */
function repeatScope(
  digest: string,
  policy: Policy,
  options: EvaluateOptions,
): Record<string, unknown> {
  return {
    challenge: digest,
    policy,
    agent_id: options.agentId,
    expected: options.expected,
    payment_history: options.paymentHistory,
    payer_age: options.payerAge,
    mandate: options.mandate,
    payment_identifier: options.paymentIdentifier,
  };
}

function withRepeatCheck(result: EvaluateResult, repeatCheck: RepeatCheck): EvaluateResult {
  return { ...result, repeat_check: repeatCheck };
}

/**
 * Evaluate a challenge with the retried-preflight check (#444).
 *
 * This is the async entry point for hosts that expose `evaluate_mcp_payment`: it computes the
 * challenge digest, derives a salted `(challenge, decision inputs)` key, returns the stored verdict
 * as a **repeat** when one exists, and otherwise runs the ordinary synchronous `evaluatePayment()`
 * and remembers the result.
 *
 * Failure discipline: a store that is absent, unreadable, unsalted, or cannot write never blocks a
 * payment. The fresh verdict is returned and `repeat_check.reason` names what happened.
 */
export async function evaluateWithChallengeIdempotency(
  pr: PaymentRequest,
  policy: Policy,
  options: ChallengeIdempotencyOptions = {},
): Promise<EvaluateResult> {
  const {
    challengeStore,
    challengeSalt,
    challengeDigest: _precomputed,
    ...evaluateOptions
  } = options;
  void _precomputed;

  let digest: string;
  try {
    digest = await challengeDigest(pr);
  } catch {
    // A request so malformed it cannot be canonicalised still gets a verdict; `evaluatePayment`
    // will refuse it. The repeat check simply did not run.
    return withRepeatCheck(evaluatePayment(pr, policy, evaluateOptions), {
      checked: false,
      reason: REPEAT_REASON.digestUnavailable,
    });
  }

  // Absence is today's behaviour, said out loud. This is the common case for a library caller and
  // for a host with no store: the agent still gets its plain stateless verdict.
  if (challengeStore === undefined) {
    return withRepeatCheck(evaluatePayment(pr, policy, { ...evaluateOptions, challengeDigest: digest }), {
      checked: false,
      reason: REPEAT_REASON.storeAbsent,
    });
  }

  if (typeof challengeSalt !== "string" || challengeSalt.length === 0) {
    return withRepeatCheck(evaluatePayment(pr, policy, { ...evaluateOptions, challengeDigest: digest }), {
      checked: false,
      reason: REPEAT_REASON.saltMissing,
    });
  }

  let key: string;
  try {
    const repeatKey = await sha256Hex(repeatScope(digest, policy, evaluateOptions));
    key = await deriveChallengeKey(repeatKey, challengeSalt);
  } catch {
    return withRepeatCheck(evaluatePayment(pr, policy, { ...evaluateOptions, challengeDigest: digest }), {
      checked: false,
      reason: REPEAT_REASON.storeUnreadable,
    });
  }

  let prior: ChallengeVerdictRecord | null;
  try {
    prior = await challengeStore.lookup(key);
  } catch {
    // A store outage is missing data, not a verdict. Evaluate fresh and say the check did not run.
    prior = null;
    return withRepeatCheck(evaluatePayment(pr, policy, { ...evaluateOptions, challengeDigest: digest }), {
      checked: false,
      reason: REPEAT_REASON.storeUnreadable,
    });
  }

  if (prior !== null) {
    // Return the original verdict, not a re-decision. Strip defensive repeat markers a custom
    // store might have persisted, then add this call's markers and one transcript note.
    const original: EvaluateResult = { ...prior.verdict };
    delete original.repeated;
    delete original.as_of;
    const steps = Array.isArray(original.steps) ? original.steps : [];
    const repeatStep = {
      seq: steps.length + 1,
      rule: "result.repeat",
      scope: "result" as const,
      outcome: "note" as const,
      detail: `repeat of the verdict issued at ${prior.as_of} — the challenge and decision inputs are unchanged, so it was not re-evaluated`,
    };
    return {
      ...original,
      challenge_digest: digest,
      repeated: true,
      as_of: prior.as_of,
      repeat_check: { checked: true, reason: REPEAT_REASON.repeat },
      steps: [...steps, repeatStep],
    };
  }

  const evaluatedAt = evaluateOptions.now ?? new Date();
  const fresh = evaluatePayment(pr, policy, {
    ...evaluateOptions,
    now: evaluatedAt,
    challengeDigest: digest,
  });
  const result = withRepeatCheck(fresh, { checked: true, reason: REPEAT_REASON.firstSight });
  try {
    await challengeStore.remember(key, { verdict: fresh, as_of: evaluatedAt.toISOString() });
  } catch {
    // The payment already has a verdict; a write failure only means the *next* retry will not be
    // recognised. Say so instead of pretending the check is in force.
    result.repeat_check = { checked: true, reason: REPEAT_REASON.storeWriteFailed };
  }
  return result;
}
