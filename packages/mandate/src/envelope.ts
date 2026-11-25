/**
 * Issue, verify and revoke a mandate.
 *
 * The signature scheme is the receipt scheme (`apps/hosted/src/receipt.ts` and
 * `packages/receipt-verify`): canonical JSON with recursively sorted keys, ES256 over the canonical
 * bytes, base64url raw `r||s`, and the published receipt `kid`. We import `canonicalize` from
 * `@paystage/receipt-verify` rather than copying it, so the two formats cannot drift apart.
 *
 * `verify()` never throws. "I could not check this" and "this is forged" are different answers, and
 * an unverifiable mandate must never be presented as a valid one.
 */

import { canonicalize, type JwkLike } from "@paystage/receipt-verify";
import {
  MANDATE_KEY_ID,
  MANDATE_SERIAL_PREFIX,
  MANDATE_VERSION,
  type Mandate,
  type MandatePayload,
  type MandateScope,
  type Revocation,
  type RevocationPayload,
} from "./types.js";

const webcrypto = globalThis.crypto;

const SIGNATURE_FIELDS = new Set(["kid", "signature"]);
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;

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

function base64UrlToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/** Everything the signature covers: the object minus `kid` and `signature`. */
export function mandatePayload(mandate: Mandate): MandatePayload {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mandate)) {
    if (!SIGNATURE_FIELDS.has(key)) payload[key] = value;
  }
  return payload as unknown as MandatePayload;
}

/** Everything a revocation signature covers. */
export function revocationPayload(revocation: Revocation): RevocationPayload {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(revocation)) {
    if (!SIGNATURE_FIELDS.has(key)) payload[key] = value;
  }
  return payload as unknown as RevocationPayload;
}

/** 128 random bits, URL-safe, prefixed `vch_`. A serial identifies the authority; it does not prove it. */
export function generateSerial(): string {
  const bytes = new Uint8Array(16);
  webcrypto.getRandomValues(bytes);
  return `${MANDATE_SERIAL_PREFIX}${base64Url(bytes.buffer)}`;
}

async function signingKey(pkcs8B64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(pkcs8B64), (ch) => ch.charCodeAt(0));
  return webcrypto.subtle.importKey("pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signPayload(key: CryptoKey, payload: unknown): Promise<string> {
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(canonicalize(payload)),
  );
  return base64Url(signature);
}

function validateScope(scope: unknown): string | null {
  if (!isRecord(scope)) return "scope is not an object";
  if (typeof scope.per_payment !== "string" || !DECIMAL_RE.test(scope.per_payment)) {
    return `scope.per_payment is not a decimal string: ${JSON.stringify(scope.per_payment)}`;
  }
  if (typeof scope.window_amount !== "string" || !DECIMAL_RE.test(scope.window_amount)) {
    return `scope.window_amount is not a decimal string: ${JSON.stringify(scope.window_amount)}`;
  }
  if (
    typeof scope.window_seconds !== "number" ||
    !Number.isInteger(scope.window_seconds) ||
    scope.window_seconds <= 0
  ) {
    return `scope.window_seconds is not a positive integer: ${JSON.stringify(scope.window_seconds)}`;
  }
  if (scope.allowed_payees !== undefined) {
    if (!Array.isArray(scope.allowed_payees) || scope.allowed_payees.length === 0) {
      return "scope.allowed_payees is present but is not a non-empty array";
    }
    if (scope.allowed_payees.some((payee) => typeof payee !== "string" || payee.trim() === "")) {
      return "scope.allowed_payees contains a value that is not a non-empty address string";
    }
  }
  return null;
}

/**
 * Validate the fields that are not `kid`/`signature`.
 *
 * `kid` is checked separately so a missing or unknown key is reported as `unknown-kid` — its own
 * status — rather than as a malformed object.
 */
function validateBody(value: Record<string, unknown>): string | null {
  if (value.v !== MANDATE_VERSION) {
    return `unsupported mandate version ${JSON.stringify(value.v)} (this verifier understands ${MANDATE_VERSION})`;
  }
  if (typeof value.serial !== "string" || value.serial.trim() === "") return "serial is not a non-empty string";
  if (typeof value.principal !== "string" || value.principal.trim() === "") {
    return "principal is not a non-empty string";
  }
  if (typeof value.agent !== "string" || value.agent.trim() === "") return "agent is not a non-empty string";
  const scopeError = validateScope(value.scope);
  if (scopeError !== null) return scopeError;
  if (typeof value.issued_at !== "string" || Number.isNaN(Date.parse(value.issued_at))) {
    return `issued_at is not a parseable timestamp: ${JSON.stringify(value.issued_at)}`;
  }
  if (typeof value.expires_at !== "string" || Number.isNaN(Date.parse(value.expires_at))) {
    return `expires_at is not a parseable timestamp: ${JSON.stringify(value.expires_at)}`;
  }
  if (typeof value.revocable !== "boolean") return "revocable is not a boolean";
  return null;
}

export interface IssueInput {
  /** The identity granting the authority. */
  principal: string;
  /** The identity receiving it. Must be a different string. */
  agent: string;
  scope: MandateScope;
  /** Omit to generate a `vch_` serial with 128 bits of randomness. */
  serial?: string;
  /** Defaults to the supplied clock (`now`, or wall time). */
  issued_at?: string | Date;
  expires_at: string | Date;
  /** Defaults to `true`: the principal commits to a revocation path. */
  revocable?: boolean;
}

export interface IssueOptions {
  /** The receipt signing key, PKCS#8 base64 — the same key format the hosted receipt builder takes. */
  signingKeyPkcs8B64?: string;
  /** Override the published key id. Rotation is additive, so the id is stamped rather than assumed. */
  kid?: string;
  /** Injectable clock, so lifetime tests do not depend on wall time. */
  now?: Date;
  /**
   * Test seam for an in-process key. Production callers pass `signingKeyPkcs8B64`, exactly as the
   * receipt builder does; supplying neither is an error rather than an unsigned mandate.
   */
  privateKey?: CryptoKey;
}

function toIso(value: string | Date | undefined, fallback: Date): string {
  const date = value === undefined ? fallback : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`not a parseable timestamp: ${JSON.stringify(value)}`);
  return date.toISOString();
}

/**
 * Issue a signed mandate.
 *
 * Refuses `agent === principal`. A mandate is the principal granting authority to a *different*
 * party; when the two are the same, the object is a permission slip the agent wrote for itself and
 * proves nothing to a seller. That refusal is the difference between the two, so it is a hard error
 * rather than a warning in a comment.
 */
export async function issue(input: IssueInput, options: IssueOptions): Promise<Mandate> {
  if (typeof input.principal !== "string" || input.principal.trim() === "") {
    throw new Error("principal must be a non-empty identity string");
  }
  if (typeof input.agent !== "string" || input.agent.trim() === "") {
    throw new Error("agent must be a non-empty identity string");
  }
  if (input.agent.trim().toLowerCase() === input.principal.trim().toLowerCase()) {
    throw new Error(
      "agent equals principal: a mandate whose agent is its own principal is a permission slip the agent wrote for itself, not an authority granted by someone else",
    );
  }
  const scopeError = validateScope(input.scope);
  if (scopeError !== null) throw new Error(`invalid mandate scope: ${scopeError}`);

  const now = options.now ?? new Date();
  const issuedAt = toIso(input.issued_at, now);
  const expiresAt = toIso(input.expires_at, now);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new Error(`expires_at ${expiresAt} must be after issued_at ${issuedAt}`);
  }

  const serial = input.serial ?? generateSerial();
  if (typeof serial !== "string" || serial.trim() === "") throw new Error("serial must be a non-empty string");

  const payload: MandatePayload = {
    v: MANDATE_VERSION,
    serial,
    principal: input.principal,
    agent: input.agent,
    scope: input.scope,
    issued_at: issuedAt,
    expires_at: expiresAt,
    revocable: input.revocable ?? true,
  };

  if (options.privateKey === undefined && !options.signingKeyPkcs8B64) {
    throw new Error("issue() needs a signing key: pass signingKeyPkcs8B64 (or privateKey in tests)");
  }
  const key = options.privateKey ?? (await signingKey(options.signingKeyPkcs8B64 as string));
  const signature = await signPayload(key, payload);
  return { ...payload, kid: options.kid ?? MANDATE_KEY_ID, signature };
}

export type MandateVerifyStatus =
  | "unsigned"
  | "expired"
  | "tampered"
  | "unknown-kid"
  | "revoked"
  | "malformed";

export type MandateVerification =
  | { ok: true; mandate: Mandate }
  | { ok: false; status: MandateVerifyStatus; reason: string };

export interface VerifyOptions {
  /** A single published key. If it carries a `kid`, it must match the mandate's. */
  jwk?: JwkLike;
  /** A published key set, selected by the mandate's `kid` (the receipt JWKS shape). */
  keys?: readonly JwkLike[];
  /**
   * Signed revocation statements to check against the serial.
   *
   * A matching statement is verified with the same key set and reported as `revoked`. An invalid
   * matching statement is `tampered` rather than ignored: an unverifiable revocation must not let a
   * mandate read as live.
   */
  revocations?: readonly Revocation[];
  /** Injectable clock for expiry tests. */
  now?: Date;
}

function usableKey(key: JwkLike): boolean {
  return key.kty === "EC" && String(key.crv) === "P-256" && (key.alg === undefined || key.alg === "ES256");
}

function selectKey(kid: string, options: VerifyOptions): JwkLike | undefined {
  if (options.jwk !== undefined) {
    if (options.jwk.kid !== undefined && String(options.jwk.kid) !== kid) return undefined;
    return options.jwk;
  }
  const keys = options.keys ?? [];
  return keys.find((key) => key.kid === kid) ?? (keys.length === 1 && keys[0].kid === undefined ? keys[0] : undefined);
}

async function signatureValid(payload: unknown, signature: string, jwk: JwkLike): Promise<boolean> {
  const key = await webcrypto.subtle.importKey(
    "jwk",
    jwk as unknown as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const bytes = base64UrlToBytes(signature);
  const exact = new Uint8Array(bytes.length);
  exact.set(bytes);
  return webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    exact,
    new TextEncoder().encode(canonicalize(payload)),
  );
}

function validateRevocation(value: unknown): string | null {
  if (!isRecord(value)) return "revocation is not an object";
  if (value.v !== MANDATE_VERSION) return `unsupported revocation version ${JSON.stringify(value.v)}`;
  if (typeof value.serial !== "string" || value.serial.trim() === "") return "revocation serial is not a non-empty string";
  if (typeof value.revoked_at !== "string" || Number.isNaN(Date.parse(value.revoked_at))) {
    return `revoked_at is not a parseable timestamp: ${JSON.stringify(value.revoked_at)}`;
  }
  if (value.reason !== undefined && typeof value.reason !== "string") return "revocation reason is not a string";
  return null;
}

/**
 * Check a mandate. Returns a verdict rather than throwing, and never reports an unverifiable object as
 * valid.
 *
 * Order matters: the signature is checked before expiry, so an expired mandate is reported as
 * `expired` only when it is genuinely signed. A matching, valid revocation is checked before expiry —
 * a revoked mandate stays revoked after it expires.
 */
export async function verify(mandate: unknown, options: VerifyOptions = {}): Promise<MandateVerification> {
  try {
    if (!isRecord(mandate)) return { ok: false, status: "malformed", reason: "mandate is not an object" };
    if (mandate.v !== undefined && mandate.v !== MANDATE_VERSION) {
      return {
        ok: false,
        status: "malformed",
        reason: `unsupported mandate version ${JSON.stringify(mandate.v)} (this verifier understands ${MANDATE_VERSION})`,
      };
    }
    if (typeof mandate.signature !== "string" || mandate.signature.length === 0) {
      return {
        ok: false,
        status: "unsigned",
        reason: "mandate carries no signature — it records what someone wrote, but cannot prove the principal granted it",
      };
    }
    const bodyError = validateBody(mandate);
    if (bodyError !== null) return { ok: false, status: "malformed", reason: bodyError };

    const kid = mandate.kid;
    if (typeof kid !== "string" || kid.trim() === "") {
      return {
        ok: false,
        status: "unknown-kid",
        reason: "mandate names no kid, so no published key can be selected and the signature cannot be checked",
      };
    }
    const jwk = selectKey(kid, options);
    if (jwk === undefined) {
      return {
        ok: false,
        status: "unknown-kid",
        reason: `the supplied key set has no key with kid ${JSON.stringify(kid)} — an unverifiable mandate is not a valid one`,
      };
    }
    if (!usableKey(jwk)) {
      return {
        ok: false,
        status: "unknown-kid",
        reason: `the key for kid ${JSON.stringify(kid)} is not an ES256 (P-256) key: kty=${String(jwk.kty)} crv=${String(jwk.crv)} alg=${String(jwk.alg)}`,
      };
    }

    let valid: boolean;
    try {
      valid = await signatureValid(mandatePayload(mandate as unknown as Mandate), mandate.signature, jwk);
    } catch {
      return { ok: false, status: "tampered", reason: "signature is not valid base64url or could not be checked" };
    }
    if (!valid) {
      return {
        ok: false,
        status: "tampered",
        reason: "signature does not match the payload — the mandate was altered or was signed by a different key",
      };
    }

    const revocations = options.revocations ?? [];
    const matching = revocations.filter((revocation) => isRecord(revocation) && revocation.serial === mandate.serial);
    for (const revocation of matching) {
      const revocationError = validateRevocation(revocation);
      if (revocationError !== null) {
        return {
          ok: false,
          status: "tampered",
          reason: `a revocation statement for serial ${String(mandate.serial)} is malformed (${revocationError}); refusing to read the mandate as live`,
        };
      }
      const revocationKid = revocation.kid;
      const revocationKey =
        typeof revocationKid === "string" ? selectKey(revocationKid, options) : undefined;
      if (revocationKey === undefined || typeof revocation.signature !== "string") {
        return {
          ok: false,
          status: "tampered",
          reason: `a revocation statement for serial ${String(mandate.serial)} cannot be verified against the supplied key set; refusing to read the mandate as live`,
        };
      }
      let revocationValid: boolean;
      try {
        revocationValid = await signatureValid(
          revocationPayload(revocation as unknown as Revocation),
          revocation.signature,
          revocationKey,
        );
      } catch {
        revocationValid = false;
      }
      if (!revocationValid) {
        return {
          ok: false,
          status: "tampered",
          reason: `a revocation statement for serial ${String(mandate.serial)} is not validly signed; refusing to read the mandate as live`,
        };
      }
      return {
        ok: false,
        status: "revoked",
        reason: `serial ${String(mandate.serial)} was revoked at ${String(revocation.revoked_at)}`,
      };
    }

    const now = options.now ?? new Date();
    const expiresAt = Date.parse(String(mandate.expires_at));
    if (now.getTime() > expiresAt) {
      const expiredBy = Math.round((now.getTime() - expiresAt) / 1000);
      return {
        ok: false,
        status: "expired",
        reason: `mandate expired ${expiredBy}s ago (${String(mandate.expires_at)}) — ask the principal for a fresh mandate`,
      };
    }

    return { ok: true, mandate: mandate as unknown as Mandate };
  } catch (error) {
    return {
      ok: false,
      status: "tampered",
      reason: `could not verify the mandate: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface RevokeOptions {
  signingKeyPkcs8B64?: string;
  kid?: string;
  now?: Date;
  reason?: string;
  /** Test seam; production callers pass `signingKeyPkcs8B64`. */
  privateKey?: CryptoKey;
}

/**
 * Sign a revocation statement that names a mandate serial.
 *
 * The mandate itself is never modified. The statement is independently verifiable and can travel on
 * any channel, which is why revoking does not require re-signing the original bundle.
 */
export async function revoke(mandate: Mandate, options: RevokeOptions): Promise<Revocation> {
  if (mandate === null || typeof mandate !== "object" || typeof mandate.serial !== "string" || mandate.serial === "") {
    throw new Error("revoke() needs a mandate with a serial");
  }
  if (options.privateKey === undefined && !options.signingKeyPkcs8B64) {
    throw new Error("revoke() needs a signing key: pass signingKeyPkcs8B64 (or privateKey in tests)");
  }
  const payload: RevocationPayload = {
    v: MANDATE_VERSION,
    serial: mandate.serial,
    revoked_at: (options.now ?? new Date()).toISOString(),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
  const key = options.privateKey ?? (await signingKey(options.signingKeyPkcs8B64 as string));
  const signature = await signPayload(key, payload);
  return { ...payload, kid: options.kid ?? MANDATE_KEY_ID, signature };
}

/** SHA-256 over the canonical signed payload, lowercase hex. A stable id for logs and diffs. */
export async function mandateDigest(mandate: Mandate): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(mandatePayload(mandate)));
  return toHex(await webcrypto.subtle.digest("SHA-256", bytes));
}
