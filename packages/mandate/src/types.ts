/**
 * The mandate object (#412): a signed, scoped, revocable authority the payer's principal grants an
 * agent, and a seller verifies before serving.
 *
 * The envelope deliberately reuses the receipt signing scheme — ES256 (ECDSA P-256 + SHA-256), JSON
 * with recursively sorted keys, a base64url WebCrypto raw `r||s` signature, and a published `kid` —
 * rather than inventing a second format. A mandate is its own object, not a receipt: a receipt says
 * what was decided; a mandate says what the agent may do next.
 *
 * Signed payload: every field except `kid` and `signature`, exactly as the receipt excludes
 * `key_id` and `signature`. The signature therefore covers the scope, both identities, the serial and
 * the lifetime; changing any of them is a `tampered` result, not a quiet reinterpretation.
 */

/** The only envelope version this implementation understands. */
export const MANDATE_VERSION = 1;

/** The signing scheme, named the same way a receipt names it. ES256 only; no algorithm negotiation. */
export const MANDATE_ALG = "ECDSA-P256-SHA256";

/** The default `kid`: the receipt key published by the receipt JWKS route, reused rather than rotated in. */
export const MANDATE_KEY_ID = "paystage-receipt-v1";

/**
 * A serial is a public identifier, not a secret. Issue generates `vch_` plus 128 random bits when the
 * caller does not supply one. The pattern is intentionally not enforced here because the hosted lookup
 * (#423) accepts both the full serial and a short pass code; a verifier must not be narrower than the
 * endpoint it checks.
 */
export const MANDATE_SERIAL_PREFIX = "vch_";

/**
 * What the principal lets the agent do.
 *
 * Amounts are decimal strings in whole units of the payment asset (`"2.00"`, not atomic units),
 * matching the seller-facing scope in the `GET /v1/mandate/:serial` contract. The mandate has no
 * asset field in v1: the seller supplies the asset's decimals when evaluating, and must separately
 * check that the asset is the one it expects. See `docs/specs/mandate.md`.
 */
export interface MandateScope {
  /** Ceiling for one payment, inclusive. */
  per_payment: string;
  /** Ceiling for the sum of settled payments inside `window_seconds`, inclusive. */
  window_amount: string;
  /** Length of the rolling window in seconds. */
  window_seconds: number;
  /**
   * Optional payee allow-list. EVM addresses compare case-insensitively. Omitted means "any payee",
   * which is a real widening and must be visible in the object rather than inferred.
   */
  allowed_payees?: string[];
}

/** The signed mandate. */
export interface Mandate {
  v: number;
  /** Public identifier; the revocation statement names this value. */
  serial: string;
  /**
   * The human or organisation granting the authority. A self-asserted label; nothing in the mandate
   * proves it names a legal person.
   */
  principal: string;
  /** The agent receiving the authority. Must not equal `principal` — see `issue()`. */
  agent: string;
  scope: MandateScope;
  /** ISO 8601 instant the authority begins. */
  issued_at: string;
  /** ISO 8601 instant the authority ends. Checked against the verifier's clock. */
  expires_at: string;
  /** Whether the principal offers a revocation path before expiry. */
  revocable: boolean;
  /** Which published key signed this envelope. */
  kid: string;
  /** Base64url ES256 signature over the canonical payload. */
  signature: string;
}

/** The bytes the signature covers: the mandate minus `kid` and `signature`. */
export type MandatePayload = Omit<Mandate, "kid" | "signature">;

/**
 * A revocation is a separate signed statement that names a serial.
 *
 * It is not a mutation of the mandate: the mandate is immutable and signed, so re-signing it to mark
 * it revoked would mean a revocation can be lost in a queue and the bundle would have to be rebuilt.
 * A statement is additive, verifiable on its own, and distributable on any channel.
 */
export interface Revocation {
  v: number;
  serial: string;
  /** ISO 8601 instant the principal revoked the authority. */
  revoked_at: string;
  /** Optional human-readable reason; not trusted for a decision. */
  reason?: string;
  kid: string;
  signature: string;
}

/** The bytes a revocation signature covers: the statement minus `kid` and `signature`. */
export type RevocationPayload = Omit<Revocation, "kid" | "signature">;
