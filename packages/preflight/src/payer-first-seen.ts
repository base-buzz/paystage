/**
 * Payer first-seen (#409) — the only payer-age fact this project keeps.
 *
 * A payer is stored under a **salted key**, never under its address. The key is
 * `HMAC-SHA-256(salt, "paystage.payer-first-seen.v1\0" + normalised payer)`. The salt is a
 * deployment secret supplied by the operator; it is not in this file, not in the migration and
 * not in git. Reading the table therefore does not reveal an address, and two tables written with
 * different salts cannot be joined on the key.
 *
 * What the salt does **not** protect: it is not anonymity. Anyone who holds the salt and an
 * address can compute the key and test whether that payer is present. The service itself can
 * always do that — the key is pseudonymous to a reader, not unlinkable to us. The store also does
 * not hide the on-chain payment, which is public and names the payer.
 *
 * What the store deliberately does **not** keep: the address, a payee/merchant id, an amount, a
 * payment history, or any table that could join two sightings into an address graph. It holds one
 * row per salted key with the first instant we saw it — no last_seen, no count, no counterparty.
 *
 * The interface is injected. The evaluator never imports a database client; a host passes a
 * `PayerFirstSeenStore` to `resolvePayerAge`, and tests pass a fixture.
 */

/** One day, the unit the payer-age rule is written in. */
const DAY_MS = 86_400_000;

/** Domain separation: a key derived here cannot collide with the same salt used for another purpose. */
const KEY_DOMAIN = "paystage.payer-first-seen.v1";

/** The only shape a stored key may have: lowercase hex SHA-256 output. */
const PAYER_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * What the evaluator may know about a payer's age.
 *
 * `known: false` is "the store did not answer", not "the payer is new". The evaluator fail-opens on
 * it, because a missing store must not turn every payment into a review.
 */
export type PayerAgeInput =
  | { readonly known: true; readonly ageDays: number }
  | { readonly known: false };

/**
 * One answer from the store.
 *
 * `unseen` means the store answered and has no row — the first sighting is now. `unknown` means the
 * store could not answer (not configured, unreachable, malformed row); that is missing data, not a
 * new payer.
 */
export type PayerFirstSeenLookup =
  | { readonly status: "seen"; readonly firstSeen: Date }
  | { readonly status: "unseen" }
  | { readonly status: "unknown" };

/** The durable half of the store, injected by the host. A throw means "could not answer". */
export interface PayerFirstSeenPersistence {
  /** The stored first-seen instant as an ISO 8601 string, or `null` when the key has no row. */
  get(payerKey: string): Promise<string | null>;
  /**
   * Insert one row. Must not change an existing `first_seen`: a first sighting is the oldest
   * instant we have, and an upsert that moves it would let a payer age back into "new".
   */
  insert(payerKey: string, firstSeenIso: string): Promise<void>;
}

/** The store the age resolver consumes. Both methods may reject; the resolver treats that as unknown. */
export interface PayerFirstSeenStore {
  lookup(payerKey: string): Promise<PayerFirstSeenLookup>;
  remember(payerKey: string, firstSeen: Date): Promise<void>;
}

/** EVM addresses are case-insensitive; Solana base58 addresses are not. Normalise only the former. */
export function normalisePayer(payer: string): string {
  const trimmed = payer.trim();
  if (trimmed === "") throw new Error("payer is empty");
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function assertPayerKey(payerKey: string): void {
  if (!PAYER_KEY_RE.test(payerKey)) {
    throw new Error("payer key must be 64 lowercase hex characters produced by derivePayerKey");
  }
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Derive the stored key from a payer identifier and the operator's salt.
 *
 * Uses Web Crypto rather than `node:crypto` so this module stays usable wherever the evaluator is.
 * A missing salt is an error, never a silent empty key: an unsalted hash of an address is
 * enumerable from the public chain, which is the exact property the salt exists to remove.
 */
export async function derivePayerKey(payer: string, salt: string): Promise<string> {
  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("payer-first-seen salt is required; supply it from deployment configuration");
  }
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Web Crypto is unavailable, so a salted payer key cannot be derived");
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
    encoder.encode(`${KEY_DOMAIN}\u0000${normalisePayer(payer)}`),
  );
  return hex(new Uint8Array(signature));
}

/**
 * Bind the injected persistence to the lookup/remember contract.
 *
 * Validation is here rather than in the persistence so a malformed value cannot become a "new
 * payer": an unparseable timestamp is `unknown` (missing data), while a well-formed row is `seen`.
 */
export function createPayerFirstSeenStore(
  persistence: PayerFirstSeenPersistence,
): PayerFirstSeenStore {
  return {
    async lookup(payerKey: string): Promise<PayerFirstSeenLookup> {
      if (!PAYER_KEY_RE.test(payerKey)) return { status: "unknown" };
      try {
        const raw = await persistence.get(payerKey);
        if (raw === null) return { status: "unseen" };
        const firstSeen = new Date(raw);
        if (!Number.isFinite(firstSeen.getTime())) return { status: "unknown" };
        return { status: "seen", firstSeen };
      } catch {
        return { status: "unknown" };
      }
    },

    async remember(payerKey: string, firstSeen: Date): Promise<void> {
      assertPayerKey(payerKey);
      if (!Number.isFinite(firstSeen.getTime())) {
        throw new Error("first seen timestamp is not a valid date");
      }
      await persistence.insert(payerKey, firstSeen.toISOString());
    },
  };
}

/**
 * Resolve an evaluator input from the store.
 *
 * The first sighting is recorded here, so a later call can measure it. Every failure path is the
 * **lenient** one on purpose: no store, no key, a throwing store, an unreadable row or a clock
 * value that makes no sense all resolve to `known: false`, and the evaluator skips the age rule.
 * Treating missing data as "new" would turn a store outage into a review on every payment.
 */
export async function resolvePayerAge(
  store: PayerFirstSeenStore | undefined,
  payerKey: string | undefined,
  now: Date = new Date(),
): Promise<PayerAgeInput> {
  if (store === undefined || payerKey === undefined || payerKey === "") {
    return { known: false };
  }

  let lookup: PayerFirstSeenLookup;
  try {
    lookup = await store.lookup(payerKey);
  } catch {
    return { known: false };
  }

  if (lookup.status === "unknown") return { known: false };

  if (lookup.status === "unseen") {
    // We are seeing this payer now; that is a fact even if the write fails. Do not fail closed on
    // the write: the next call will try again and record the first-sighting then.
    try {
      await store.remember(payerKey, now);
    } catch {
      // Intentionally ignored — see above.
    }
    return { known: true, ageDays: 0 };
  }

  const elapsed = now.getTime() - lookup.firstSeen.getTime();
  if (!Number.isFinite(elapsed)) return { known: false };
  // A future timestamp is a bad row or a clock skew, not a negative age; the safe reading is the
  // youngest possible payer, which is also the stricter one for the rule.
  return { known: true, ageDays: Math.max(0, Math.floor(elapsed / DAY_MS)) };
}
