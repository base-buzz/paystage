/**
 * `POST /v1/mandate` — the mint route (#455): the caller `writeMandate` has been waiting for.
 *
 * // Route choice, one line: `POST /v1/mandate` is the write half of the record `GET /v1/mandate/:serial`
 * // reads, not a step inside the pass flow — a pass is a rendering of a mandate, not the grant, so the write
 * // must not depend on a renderer or its certificate.
 * // Owner rule, one line: the holder of the service token `MANDATE_MINT_TOKEN` may mint — the issuer backend
 * // that already holds the signing key — and every other caller is refused with `mandate_mint_unauthorized`.
 *
 * #453 shipped the table, the writer and the public read, but nothing in this tree called the writer, so
 * every serial a person could hold still answered `unknown`. This route is that caller: it takes a
 * **signed** mandate envelope, verifies it with `@paystage/mandate.verify`, writes the row through
 * `writeMandate`, and answers `{ serial, verification_url }`.
 *
 * **Why one route and not a step inside the pass flow.** A pass is a rendering of a mandate, not the
 * moment authority is granted; the same envelope can produce an Apple pass, a Google pass or nothing at
 * all. Hanging the write off a renderer would mean a mandate exists only if someone happened to draw a
 * card, and it would put a database write behind the pass certificate. The write gets its own route so
 * the issuer can record authority once and hand the serial to whatever renders it.
 *
 * **Who may mint (the row's whole question).** The holder of the service token `MANDATE_MINT_TOKEN` —
 * the issuer backend that already holds the receipt signing key. This Worker has no console session
 * and no browser credential, so a bearer service token is the strongest owner it can actually check;
 * every other caller is refused with `mandate_mint_unauthorized`. A mint route without an owner is an
 * open endpoint that creates capabilities, which is why an unset token refuses *every* mint rather than
 * defaulting to open, and why the token is checked before the body is even parsed.
 *
 * **The serial is not the caller's.** The serial, scope, identities and lifetime all come from the
 * object `verify` accepted. A body-level `serial` is ignored on purpose (and tested): accepting it would
 * let a caller choose a capability name, and a serial is only a capability while it is unguessable.
 * The same rule is why a short `vch-ABC` code is refused — it is 3 characters, a display handle on the
 * pass face, and trivially guessable.
 *
 * **No row exists after a refusal.** Every check runs before `writeMandate`, and each refusal is a
 * named problem code. The store is also re-read for an existing serial first, so a revoked row answers
 * `mandate_revoked` instead of a generic duplicate.
 *
 * **A revoked envelope cannot be minted.** Revocation is a separate signed statement in this package,
 * so the route accepts the statements a caller has seen (`revocations` in the body) and passes them to
 * `verify`, exactly as a seller would. A statement that matches and verifies is `revoked`; one that
 * does not verify fails closed as `tampered` rather than letting the mandate through.
 *
 * **It is stricter than `writeMandate` on expiry, on purpose.** The writer may record an already-expired
 * mandate as `expired` (a row that records history). A *mint* is the moment a capability starts, so a
 * signed expiry in the past is refused with `mandate_expired` instead of writing a dead row.
 *
 * **The envelope never comes back.** The answer is the serial and the verification URL — never the
 * envelope, signature or scope. The public read at `GET /v1/mandate/:serial` is the one projection.
 *
 * **No telemetry on this route.** `toolFromPath()` does not name it, so the global request log is the
 * only trace, and no `recordEvent` call is made here. A mint is not an evaluation and must not appear
 * in the tool-call numbers.
 */

import { Hono } from "hono";
import { verify, type Revocation, type VerifyOptions } from "@paystage/mandate";
import { PROBLEMS } from "../problem.js";
import { parseOrgUnitForTenant } from "../org-unit.js";
import { bearerToken, constantTimeEqual } from "./service-auth.js";
import {
  DuplicateMandateError,
  writeMandate,
  type MandateStore,
} from "../mandate-store.js";

/** The key an envelope's `kid` selects, in the shape `verify` accepts. */
export type VerificationKey = NonNullable<VerifyOptions["keys"]>[number];

/**
 * The URL the pass's QR carries, and the page the serial resolves to.
 *
 * Same literal as `VERIFICATION_BASE` in `packages/pass/src/face.ts`. The Worker does not import
 * `@paystage/pass` (it would pull the pkijs/Apple-pass machinery into the edge bundle for one string),
 * so a test reads both files and fails if the two drift apart.
 */
export const MINT_VERIFICATION_BASE = "https://paystage.xyz/m/";

/**
 * A *mintable* serial is the full `vch_` form only: 22-64 URL-safe characters after the prefix, i.e.
 * at least 128 bits of randomness when `generateSerial()` made it.
 *
 * Deliberately narrower than `MANDATE_SERIAL_RE` in `routes/mandate.ts`, which also accepts the 3-
 * character `vch-ABC` display code so a printed pass face still resolves. Three characters is
 * guessable, and a guessable serial is not a capability — a mint is the one place that can be refused.
 */
export const MINT_SERIAL_RE = /^vch_[A-Za-z0-9_-]{22,64}$/;

export interface MandateMintOptions {
  /** The store's write half. `undefined` (no Supabase bindings) means minting is not configured. */
  store: MandateStore | undefined;
  /** `MANDATE_MINT_TOKEN`, a Wrangler secret. `undefined` or empty refuses every mint. */
  token: string | undefined;
  /** `MANDATE_TENANT_ID`: the tenant every minted row belongs to. Never a request field. */
  tenantId: string | undefined;
  /**
   * The published key set, selected by the envelope's `kid`. A thunk because deriving a JWK from PKCS#8
   * is async and `createApp` is not.
   */
  verificationKeys: () => Promise<readonly VerificationKey[]>;
  /** Injectable clock, so the expiry and lifetime tests do not depend on wall time. */
  now?: () => Date;
}

const CACHE = { "cache-control": "no-store, max-age=0" };

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The signed revocation statements a caller has seen, or a refusal when the field is not a list. */
function revocationsFrom(body: Record<string, unknown>): { ok: true; revocations: Revocation[] } | { ok: false } {
  const raw = body.revocations;
  if (raw === undefined) return { ok: true, revocations: [] };
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.some((entry) => !isRecord(entry))) return { ok: false };
  return { ok: true, revocations: raw as Revocation[] };
}

/** The serial an unverified envelope names, for the refusal wording only. Never used to decide anything. */
function claimedSerial(envelope: unknown): string {
  return isRecord(envelope) && typeof envelope.serial === "string" ? envelope.serial : "unknown";
}

/** The refusal for a `verify` status. Each one is a distinct problem code, so a client can act on it. */
function refusalFor(status: string, reason: string, serial: string) {
  switch (status) {
    case "unsigned":
      return PROBLEMS.mandateUnsigned(reason);
    case "unknown-kid":
      return PROBLEMS.mandateUnknownKid(reason);
    case "expired":
      return PROBLEMS.mandateExpired(reason);
    case "revoked":
      return PROBLEMS.mandateRevoked(serial);
    case "tampered":
      return PROBLEMS.mandateTampered(reason);
    default:
      return PROBLEMS.mandateMalformed(reason);
  }
}

export function createMandateMintRoutes(options: MandateMintOptions): Hono {
  const routes = new Hono();

  routes.post("/v1/mandate", async (c) => {
    const now = options.now?.() ?? new Date();

    // 1. Is this deployment able to mint at all? Fail closed, and say why: a route that half-works
    //    would either write without a tenant (no RLS) or verify against an empty key set.
    let keys: readonly VerificationKey[];
    try {
      keys = await options.verificationKeys();
    } catch {
      keys = [];
    }
    if (
      options.store === undefined ||
      !nonEmpty(options.token) ||
      !nonEmpty(options.tenantId) ||
      keys.length === 0
    ) {
      return c.json(PROBLEMS.mandateMintNotConfigured(), 503, CACHE);
    }

    // 2. The owner check comes first: an unauthenticated caller must not be able to learn anything
    //    about which envelope errors exist here.
    const presented = bearerToken(c.req.header("authorization"));
    if (presented === null || !(await constantTimeEqual(presented, options.token))) {
      return c.json(PROBLEMS.mandateMintUnauthorized(), 401, CACHE);
    }

    // 3. The body is `{ envelope, revocations?, serial?, org_unit? }`. `envelope`, `revocations` and the
    //    optional allocation label are read; a body-level `serial` is never read (see step 5).
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(PROBLEMS.invalidJson(), 400, CACHE);
    }
    if (!isRecord(body) || !isRecord(body.envelope)) {
      return c.json(PROBLEMS.mandateEnvelopeRequired(), 400, CACHE);
    }
    const parsedRevocations = revocationsFrom(body);
    if (!parsedRevocations.ok) {
      return c.json(
        PROBLEMS.mandateMalformed("`revocations` must be an array of signed revocation statements."),
        400,
        CACHE,
      );
    }

    // 3b. The optional allocation label (#471). It is not signed and not part of the envelope — it is
    //     the tenant's own placement of the mandate in its tree — so it is validated here and stored in
    //     its own column. Absent is normal: a single-person install has no tree, and the row sits at the
    //     tenant root. Present-but-wrong is refused rather than normalised, because a path is later used
    //     as a prefix and a quietly-corrected unit is an allocation nobody wrote.
    let orgUnit: string | null = null;
    if (body.org_unit !== undefined && body.org_unit !== null) {
      const parsedOrgUnit = parseOrgUnitForTenant(body.org_unit, options.tenantId);
      if (!parsedOrgUnit.ok) {
        return c.json(PROBLEMS.mandateOrgUnitInvalid(parsedOrgUnit.reason), 400, CACHE);
      }
      orgUnit = parsedOrgUnit.value;
    }

    // 4. Verify. The signature is checked before expiry inside `verify`, so an expired envelope here is
    //    a genuinely signed one; a tampered expired envelope is `tampered`, never `expired`.
    const verdict = await verify(body.envelope, {
      keys,
      revocations: parsedRevocations.revocations,
      now,
    });
    if (!verdict.ok) {
      return c.json(
        refusalFor(verdict.status, verdict.reason, claimedSerial(body.envelope)),
        verdict.status === "revoked" ? 409 : 400,
        CACHE,
      );
    }

    const mandate = verdict.mandate;
    const serial = mandate.serial;

    // 5. The serial is the envelope's. `body.serial`, if present, is never read — a caller does not get
    //    to name a capability. A serial the lookup could not answer, or a guessable one, is refused
    //    before any row exists.
    if (!MINT_SERIAL_RE.test(serial)) {
      return c.json(PROBLEMS.mandateSerialNotMintable(serial), 400, CACHE);
    }

    // 6. A serial already on record is never overwritten. A revoked one keeps its revocation: re-minting
    //    it would let a replayed envelope beat the statement that ended it.
    let existing: Awaited<ReturnType<MandateStore["get"]>>;
    try {
      existing = await options.store.get(serial);
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "mandate_mint_read_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json(PROBLEMS.mandateMintStoreUnavailable(), 503, CACHE);
    }
    if (existing !== null) {
      return c.json(
        existing.status === "revoked" ? PROBLEMS.mandateRevoked(serial) : PROBLEMS.mandateAlreadyMinted(serial),
        409,
        CACHE,
      );
    }

    // 7. Write. `writeMandate` re-verifies with the same key set and copies scope/principal/agent and
    //    both timestamps from the *verified* object, so the row cannot disagree with the signed bytes.
    try {
      await writeMandate(options.store, mandate, {
        tenantId: options.tenantId,
        verify: { keys },
        now,
        orgUnit,
      });
    } catch (error) {
      if (error instanceof DuplicateMandateError) {
        return c.json(PROBLEMS.mandateAlreadyMinted(serial), 409, CACHE);
      }
      console.log(
        JSON.stringify({
          level: "error",
          msg: "mandate_mint_write_failed",
          serial,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json(PROBLEMS.mandateMintStoreUnavailable(), 503, CACHE);
    }

    // 8. The serial and where to check it. Never the envelope: a mint response is a receipt that the row
    //    exists, not a second copy of the authority.
    return c.json({ serial, verification_url: `${MINT_VERIFICATION_BASE}${serial}` }, 201, CACHE);
  });

  return routes;
}
