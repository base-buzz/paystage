/**
 * The mandate store (#453): the table-backed read behind `GET /v1/mandate/:serial`, and the writer that
 * puts a signed envelope there.
 *
 * Three boundaries are load-bearing here.
 *
 *  1. **The endpoint's seam is unchanged.** `supabaseMandateStore()` implements the existing
 *     `MandateSource` so the route keeps its injected-source test seam; with no Supabase bindings the
 *     route still answers `unknown`, and a store failure still means 503, not `unknown`.
 *
 *  2. **The public read is a projection, not a row.** A serial is a capability — anyone holding it can
 *     read the record — so this adapter never selects `agent`, never returns `scope.allowed_payees`,
 *     and has no spend-history column to leak. The endpoint's contract is the reason for the strip:
 *     no payee list, no spend history, no agent address on the public answer. Stripping happens here,
 *     not in the route, so a future route change cannot widen the answer by accident.
 *
 *  3. **The envelope is the record.** The writer verifies the signature with `@paystage/mandate.verify`
 *     before inserting, and stores the verified object verbatim. Revocation is a second signed
 *     statement plus a state update on the row; the signed bytes are never edited.
 *
 * The Supabase calls use the REST endpoint directly, matching `payee-observation-store.ts` and
 * `bundle-store.ts` (no `@supabase/supabase-js` in the Worker bundle). Reads and writes are server-side
 * and use the service role, which bypasses RLS; the migration's tenant policies protect tenant-scoped
 * sessions instead. No credential is hardcoded — both values come from the environment at runtime.
 */

import {
  verify,
  type Mandate,
  type Revocation,
  type VerifyOptions,
} from "@paystage/mandate";
import type { MandateRecord, MandateSource } from "./routes/mandate.js";

export interface MandateStorageEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** The three states the package and the table agree on. */
export type MandateState = "active" | "revoked" | "expired";

/** One stored row. `envelope` is the verified signed object, byte-for-byte. */
export interface MandateRow {
  serial: string;
  tenant_id: string;
  state: MandateState;
  scope: unknown;
  issued_at: string;
  expires_at: string;
  principal: string;
  agent: string;
  envelope: Mandate;
  revoked_at: string | null;
  revocation: Revocation | null;
  created_at: string;
}

export type NewMandateRow = Pick<
  MandateRow,
  "serial" | "tenant_id" | "state" | "scope" | "issued_at" | "expires_at" | "principal" | "agent" | "envelope"
>;

/** The write half. Reads go through the endpoint's `MandateSource`; writes are a server-side concern. */
export interface MandateWriter {
  /** Insert one row. A duplicate serial is an error, not an overwrite: the envelope is immutable. */
  insert(row: NewMandateRow): Promise<void>;
  /**
   * Flip an existing row to revoked and store the signed statement. Only `state`, `revoked_at` and
   * `revocation` change; `envelope` is untouched on purpose.
   */
  revoke(serial: string, revocation: Revocation, revokedAt: string): Promise<void>;
}

export interface MandateStore extends MandateSource, MandateWriter {}

function nonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The scope the public endpoint may see: the two caps and the window, nothing else.
 *
 * The signed scope can carry `allowed_payees`. That list stays inside `envelope`/`scope` in storage and
 * is removed here because the endpoint contract says the public answer has no payee list. A malformed
 * scope is an unreadable record (the caller answers 503), never a fabricated zero-limit one.
 */
function publicScope(value: unknown): { per_payment: string; window_amount: string; window_seconds: number } {
  if (!isRecord(value)) throw new Error("mandate scope is not an object");
  const { per_payment, window_amount, window_seconds } = value;
  if (typeof per_payment !== "string" || per_payment === "") throw new Error("mandate scope has no per_payment");
  if (typeof window_amount !== "string" || window_amount === "") throw new Error("mandate scope has no window_amount");
  if (typeof window_seconds !== "number" || !Number.isInteger(window_seconds) || window_seconds <= 0) {
    throw new Error("mandate scope has no positive window_seconds");
  }
  return { per_payment, window_amount, window_seconds };
}

function isState(value: unknown): value is MandateState {
  return value === "active" || value === "revoked" || value === "expired";
}

/**
 * Turn one selected row into the endpoint's record shape.
 *
 * Never returns `tenant_id`, `agent`, `envelope`, `revocation` or the payee list: those are storage
 * facts, not part of a public answer about an authority.
 */
function toPublicRecord(row: unknown): MandateRecord {
  if (!isRecord(row)) throw new Error("mandate row is not an object");
  if (typeof row.serial !== "string" || row.serial === "") throw new Error("mandate row has no serial");
  if (!isState(row.state)) throw new Error("mandate row has an unknown state");
  if (typeof row.expires_at !== "string" || Number.isNaN(Date.parse(row.expires_at))) {
    throw new Error("mandate row has no parseable expires_at");
  }
  if (typeof row.principal !== "string" || row.principal === "") throw new Error("mandate row has no principal");
  const scope = publicScope(row.scope);
  return {
    serial: row.serial,
    status: row.state,
    per_payment: scope.per_payment,
    window_amount: scope.window_amount,
    window_seconds: scope.window_seconds,
    expires_at: row.expires_at,
    principal: { display: row.principal, assertion: "self" },
  };
}

/** A Supabase REST-backed store, or undefined when this deployment has no storage configured. */
export function supabaseMandateStore(env: MandateStorageEnv): MandateStore | undefined {
  const rawUrl = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!nonEmpty(rawUrl) || !nonEmpty(key)) return undefined;
  const endpoint = `${rawUrl.replace(/\/+$/, "")}/rest/v1/mandates`;

  return {
    async get(serial: string): Promise<MandateRecord | null> {
      // The column list is the stripping rule at source: `agent`, `envelope`, `revocation` and
      // `tenant_id` are never fetched on the public path, so they cannot be returned by a later change
      // to the mapping either.
      const query =
        `?serial=eq.${encodeURIComponent(serial)}` +
        "&select=serial,state,scope,expires_at,principal" +
        "&limit=1";
      const res = await fetch(`${endpoint}${query}`, { headers: { ...headers(key), Prefer: "count=none" } });
      if (!res.ok) {
        // Status only: a PostgREST error body can echo row values, and this route is public.
        throw new Error(`mandate read failed (HTTP ${res.status})`);
      }
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) throw new Error("mandate read returned a non-array body");
      if (rows.length === 0) return null;
      return toPublicRecord(rows[0]);
    },

    async insert(row: NewMandateRow): Promise<void> {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers(key), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(`mandate insert failed (HTTP ${res.status})`);
    },

    async revoke(serial: string, revocation: Revocation, revokedAt: string): Promise<void> {
      // A PATCH on the three revocation columns, never on `envelope`: the signed object is immutable.
      const query = `?serial=eq.${encodeURIComponent(serial)}&select=serial`;
      const res = await fetch(`${endpoint}${query}`, {
        method: "PATCH",
        headers: {
          ...headers(key),
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ state: "revoked", revoked_at: revokedAt, revocation }),
      });
      if (!res.ok) throw new Error(`mandate revoke failed (HTTP ${res.status})`);
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) throw new Error("mandate revoke returned a non-array body");
      if (rows.length === 0) throw new Error(`no stored mandate for serial ${serial}`);
    },
  };
}

export interface WriteMandateOptions {
  /** The tenant that owns the mandate. RLS keys on this; the writer refuses an empty value. */
  tenantId: string;
  /** The published key set (or single `jwk`) `verify` checks the signature against. */
  verify?: VerifyOptions;
  /** Injectable clock, so lifetime states do not depend on wall time in tests. */
  now?: Date;
  /**
   * Optional requested initial state. Defaults to the state the envelope's lifetime implies. A caller
   * asking for a state the envelope contradicts is refused rather than silently overridden.
   */
  state?: "active" | "expired";
}

/**
 * Verify a signed envelope and insert the row that records it.
 *
 * Refusal, not correction:
 *  - a signature that does not verify (unsigned, tampered, unknown kid) is an error;
 *  - a validly signed but already-expired mandate may be stored as `expired` (the signature was checked
 *    before expiry inside `verify`), but it may not be labelled `active`;
 *  - `revoked` is never an insert state: revocation is its own statement and its own update.
 *
 * The row's scope/principal/agent/issued_at/expires_at are copied from the *verified* object, not from
 * the caller, so the projection cannot disagree with the signed bytes.
 */
export async function writeMandate(
  store: MandateWriter,
  mandate: Mandate,
  options: WriteMandateOptions,
): Promise<{ serial: string; state: "active" | "expired" }> {
  if (!nonEmpty(options.tenantId) || options.tenantId.trim() === "") {
    throw new Error("writeMandate needs a non-empty tenantId");
  }

  const verdict = await verify(mandate, options.verify ?? {});
  if (!verdict.ok && verdict.status !== "expired") {
    throw new Error(`refusing to write mandate ${String((mandate as { serial?: unknown }).serial)}: ${verdict.status}: ${verdict.reason}`);
  }
  // `verify` checks the signature before it checks expiry, so an `expired` verdict still means the
  // envelope was signed. Refusing it outright would make an expired row impossible to record.
  const signed = mandate;
  const now = options.now ?? new Date();
  const expiresAtMs = Date.parse(signed.expires_at);
  if (!Number.isFinite(expiresAtMs)) throw new Error("refusing to write mandate: expires_at is not parseable");

  const implied: "active" | "expired" = expiresAtMs <= now.getTime() ? "expired" : "active";
  if (options.state !== undefined && options.state !== implied) {
    throw new Error(
      `refusing to write mandate ${signed.serial} as ${options.state}: its signed expiry (${signed.expires_at}) implies ${implied}`,
    );
  }

  await store.insert({
    serial: signed.serial,
    tenant_id: options.tenantId,
    state: implied,
    scope: signed.scope,
    issued_at: signed.issued_at,
    expires_at: signed.expires_at,
    principal: signed.principal,
    agent: signed.agent,
    // Exactly the object `verify` accepted, signature included.
    envelope: signed,
  });
  return { serial: signed.serial, state: implied };
}

export interface RevokeStoredMandateOptions {
  verify?: VerifyOptions;
  now?: Date;
}

/**
 * Record a revocation: verify the statement against the same key set, then update the row.
 *
 * The mandate is passed so `verify` can check the statement covers *this* serial. The stored envelope
 * is not passed back to storage and is not re-signed; only the revocation columns and `state` change.
 */
export async function revokeStoredMandate(
  store: MandateWriter,
  mandate: Mandate,
  revocation: Revocation,
  options: RevokeStoredMandateOptions = {},
): Promise<void> {
  if (revocation.serial !== mandate.serial) {
    throw new Error(
      `refusing to revoke ${mandate.serial}: the statement names ${revocation.serial}`,
    );
  }
  const base = options.verify ?? {};
  const verdict = await verify(mandate, {
    ...base,
    ...(options.now === undefined ? {} : { now: options.now }),
    revocations: [revocation],
  });
  // `verify` returns `revoked` only for a matching, validly signed statement; a malformed or unverifiable
  // one comes back as `tampered` and must not flip the row to the state a seller trusts least.
  if (verdict.ok || verdict.status !== "revoked") {
    throw new Error(
      `refusing to revoke ${mandate.serial}: ${verdict.ok ? "the statement was not applied" : `${verdict.status}: ${verdict.reason}`}`,
    );
  }
  await store.revoke(mandate.serial, revocation, revocation.revoked_at);
}

/**
 * In-memory store for tests and local wiring checks. It applies the same public projection and the same
 * insert/revoke rules as the Supabase adapter, so a test against it exercises the endpoint's real shape.
 */
export function createMemoryMandateStore(seed: NewMandateRow[] = []): MandateStore {
  const rows = new Map<string, NewMandateRow & { revoked_at: string | null; revocation: Revocation | null }>();
  for (const row of seed) rows.set(row.serial, { ...row, revoked_at: null, revocation: null });

  return {
    get(serial: string): MandateRecord | null {
      const row = rows.get(serial);
      if (row === undefined) return null;
      return toPublicRecord(row);
    },
    async insert(row: NewMandateRow): Promise<void> {
      if (rows.has(row.serial)) throw new Error(`mandate ${row.serial} is already stored; the envelope is immutable`);
      rows.set(row.serial, { ...row, revoked_at: null, revocation: null });
    },
    async revoke(serial: string, revocation: Revocation, revokedAt: string): Promise<void> {
      const row = rows.get(serial);
      if (row === undefined) throw new Error(`no stored mandate for serial ${serial}`);
      // The envelope stays exactly as written; only the revocation projection moves.
      rows.set(serial, { ...row, state: "revoked", revoked_at: revokedAt, revocation });
    },
  };
}
