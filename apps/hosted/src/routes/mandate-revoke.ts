/**
 * `POST /v1/mandate/:serial/revoke` (#503) — the write a pass's back has been promising.
 *
 * The pass says "revocation is instant server-side"; until this route existed nothing in the tree
 * could call `revokeStoredMandate` over HTTP, so the sentence was a claim with no mechanism behind
 * it. Revocation is a **signed statement**, not a row edit: the body is the object `revoke()` from
 * `@paystage/mandate` returns (`{ v, serial, revoked_at, kid, signature, reason? }`), the route looks
 * up the immutable envelope that names the path serial, and `revokeStoredMandate` verifies the
 * statement against the same published key set the mint used before flipping the row.
 *
 * **Why the body is only the statement.** The statement is independently verifiable and is the shape
 * the store already persists. The envelope is already on record, so making a manager send it back
 * would be a second copy of authority travelling on every revoke. The route reads it server-side
 * through `getEnvelope`, which is never part of the public projection.
 *
 * **Who may revoke.** The holder of `MANDATE_REVOKE_TOKEN`, or `MANDATE_MINT_TOKEN` where no separate
 * revoke token is configured. Revocation has a different blast radius from minting — it ends authority
 * rather than creating it — so a deployment can give a manager revoke-only access. An unset token
 * refuses every revoke rather than defaulting open, and the check runs before the body is read.
 *
 * **Idempotent, not shouty.** A second click with the same statement is a `409` carrying the *first*
 * revocation's timestamp and no write: two revocations must not produce two timestamps, and a manager
 * who double-clicks has not made an error. The first statement wins.
 *
 * **Unknown is 404 here, unlike the public read.** `GET /v1/mandate/:serial` answers `unknown` with a
 * 200 because a scanner must always get an answer. A revoke is a write against a specific record: a
 * serial this deployment never minted cannot be revoked, and saying so must not look like success.
 *
 * **No secrets in logs.** A store failure logs the error and the serial, never the token or the
 * statement. No telemetry: `toolFromPath()` does not name this route, so the request log is the only
 * trace.
 */

import { Hono } from "hono";
import { MANDATE_VERSION, verify, type Revocation } from "@paystage/mandate";
import { PROBLEMS } from "../problem.js";
import { revokeStoredMandate, type MandateStore } from "../mandate-store.js";
import { MANDATE_SERIAL_RE } from "./mandate.js";
import { bearerToken, constantTimeEqual } from "./service-auth.js";
import type { VerificationKey } from "./mandate-mint.js";

export interface MandateRevokeOptions {
  /** The store's envelope read and revoke write. `undefined` means revoking is not configured. */
  store: MandateStore | undefined;
  /** `MANDATE_REVOKE_TOKEN`, falling back to `MANDATE_MINT_TOKEN`. Unset/empty refuses everyone. */
  token: string | undefined;
  /** The published key set the statement and envelope are checked against. */
  verificationKeys: () => Promise<readonly VerificationKey[]>;
  /** Injectable clock, so tests do not depend on wall time. */
  now?: () => Date;
}

const CACHE = { "cache-control": "no-store, max-age=0" };

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Shape-check the body as the store's `Revocation`. Signature validity is deliberately not checked
 * here: that is `verify`'s job through `revokeStoredMandate`, and a shape error is a different fix
 * (400 malformed) from a valid-looking statement that does not verify (400 rejected).
 */
function parseStatement(value: unknown): { ok: true; statement: Revocation } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: "The body must be one signed revocation object." };
  if (value.v !== MANDATE_VERSION) {
    return { ok: false, reason: `Unsupported revocation version ${JSON.stringify(value.v)}; this verifier understands ${MANDATE_VERSION}.` };
  }
  if (typeof value.serial !== "string" || value.serial.trim() === "") {
    return { ok: false, reason: "`serial` must be a non-empty string." };
  }
  if (typeof value.revoked_at !== "string" || !Number.isFinite(Date.parse(value.revoked_at))) {
    return { ok: false, reason: "`revoked_at` must be an ISO 8601 timestamp." };
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    return { ok: false, reason: "`reason`, when present, must be a string." };
  }
  if (typeof value.kid !== "string" || value.kid.trim() === "") {
    return { ok: false, reason: "`kid` must name the key that signed the statement." };
  }
  if (typeof value.signature !== "string" || value.signature === "") {
    return { ok: false, reason: "`signature` must be the statement's ES256 signature." };
  }
  return { ok: true, statement: value as unknown as Revocation };
}

export function createMandateRevokeRoutes(options: MandateRevokeOptions): Hono {
  const routes = new Hono();

  routes.post("/v1/mandate/:serial/revoke", async (c) => {
    const now = options.now?.() ?? new Date();
    const serial = c.req.param("serial");

    // 1. Is this deployment able to revoke at all? Fail closed and say why, exactly as the mint does.
    let keys: readonly VerificationKey[];
    try {
      keys = await options.verificationKeys();
    } catch {
      keys = [];
    }
    if (options.store === undefined || !nonEmpty(options.token) || keys.length === 0) {
      return c.json(PROBLEMS.mandateRevokeNotConfigured(), 503, CACHE);
    }

    // 2. Auth before body: an unauthenticated caller learns nothing about the statement.
    const presented = bearerToken(c.req.header("authorization"));
    if (presented === null || !(await constantTimeEqual(presented, options.token))) {
      return c.json(PROBLEMS.mandateRevokeForbidden(), 403, CACHE);
    }

    if (!MANDATE_SERIAL_RE.test(serial)) {
      return c.json(PROBLEMS.invalidSerial(serial), 400, CACHE);
    }

    // 3. The body is the statement itself, not a wrapper.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(PROBLEMS.invalidJson(), 400, CACHE);
    }
    const parsed = parseStatement(body);
    if (!parsed.ok) {
      return c.json(PROBLEMS.mandateRevocationMalformed(parsed.reason), 400, CACHE);
    }
    const statement = parsed.statement;

    // 4. The path names the record to revoke. A statement for another serial is refused rather than
    //    ignored, so a copy-paste error cannot revoke the wrong mandate or silently do nothing.
    if (statement.serial !== serial) {
      return c.json(
        PROBLEMS.mandateRevocationRejected(
          `The statement names serial ${JSON.stringify(statement.serial)}, but the path names ${JSON.stringify(serial)}.`,
        ),
        400,
        CACHE,
      );
    }

    // 5. Find the immutable envelope the statement has to cover.
    let stored: Awaited<ReturnType<MandateStore["getEnvelope"]>>;
    try {
      stored = await options.store.getEnvelope(serial);
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "mandate_revoke_read_failed",
          serial,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json(PROBLEMS.mandateRevokeStoreUnavailable(), 503, CACHE);
    }
    if (stored === null) {
      return c.json(PROBLEMS.mandateNotFound(serial), 404, CACHE);
    }

    // 6. Already revoked: the first timestamp stands, and no second write happens. This is the
    //    double-click path, so it is a conflict the caller can treat as success — not a 500.
    if (stored.state === "revoked") {
      const revokedAt = stored.revoked_at ?? statement.revoked_at;
      return c.json(
        { ...PROBLEMS.mandateAlreadyRevoked(serial, revokedAt), revoked_at: revokedAt },
        409,
        CACHE,
      );
    }

    // 7. Verify the statement before writing. `revokeStoredMandate` repeats this check, but doing it
    //    here separates "the statement does not verify" (a 400 the caller must fix) from "the store
    //    could not write" (a 503 the caller can retry).
    const verdict = await verify(stored.envelope, {
      keys,
      revocations: [statement],
      now,
    });
    if (verdict.ok || verdict.status !== "revoked") {
      const reason = verdict.ok
        ? "The statement was not applied."
        : `${verdict.status}: ${verdict.reason}`;
      return c.json(PROBLEMS.mandateRevocationRejected(reason), 400, CACHE);
    }

    // 8. The write. `revokeStoredMandate` re-verifies and updates only `state`, `revoked_at` and
    //    `revocation`; the signed envelope is never touched.
    try {
      await revokeStoredMandate(options.store, stored.envelope, statement, {
        verify: { keys },
        now,
      });
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "mandate_revoke_write_failed",
          serial,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json(PROBLEMS.mandateRevokeStoreUnavailable(), 503, CACHE);
    }

    return c.json(
      { serial, revoked_at: statement.revoked_at, status: "revoked" },
      200,
      CACHE,
    );
  });

  return routes;
}
