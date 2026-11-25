/**
 * `GET /v1/mandate/:serial` — the live record behind a Vouch pass (#423).
 *
 * Public and read-only, mounted before the payment middleware: a counterparty scanning a QR is asking
 * "does this authority still exist?", not making a new paid judgement. The route answers with the
 * status, the scope the principal wrote, the principal and the verdict a seller should take.
 *
 * **No mandate store exists in this tree.** No writer records a serial anywhere (checked 2026-11-25:
 * `apps/hosted/src/routes` had no mandate route and no store module, and `scripts/refusal-summary.mjs`
 * already exits 2 because no stored receipt carries `mandate_serial`). Rather than invent a store or
 * fabricate an `active` record, this route takes an optional read-only `MandateSource` seam; with no
 * source configured — which is every deployment today — every serial answers `unknown`. Honest
 * `unknown` beats a fabricated `active`, and the shape is stable for the day a writer lands.
 *
 * **Unknown is HTTP 200, not 404.** A scanner must always get an answer, and "unknown" is an answer:
 * a 404 is indistinguishable from a typo, a CDN miss or a route that no longer exists. `unknown` is a
 * terminal state a seller can act on (do not trust), not a transport failure.
 *
 * **No telemetry on this route.** It is public, read-only, and its URL is the pass's public
 * identifier; an event row per scan would add a scan dimension to the privacy page and make a
 * verification surface into a tracking surface. The global request log the Worker already writes is
 * the only trace, and no `recordEvent` call is made here on purpose.
 *
 * **Never cache.** `cache-control: no-store, max-age=0` because a cached "active" would outlive a
 * revocation, and instant server-side revocation is the whole point of the QR.
 */

import { Hono } from "hono";
import { PROBLEMS } from "../problem.js";

export type MandateStatus = "active" | "revoked" | "expired" | "unknown";
export type SellerVerdict = "trust" | "do_not_trust" | "unknown";

export interface MandatePrincipal {
  /** The name the issuer chose to publish. It is self-asserted; nothing here proves identity. */
  display: string;
  assertion: "self";
}

/** One stored mandate. This is a read shape, not a schema: no migration and no writer exist yet. */
export interface MandateRecord {
  serial: string;
  /** The stored state. Expiry is recomputed against `as_of` so a stale `active` cannot pass. */
  status: "active" | "revoked" | "expired";
  /** Per-transaction cap, in whole USDC as a decimal string, e.g. "2.00". */
  per_payment: string;
  /** Rolling-window ceiling, in whole USDC as a decimal string, e.g. "20.00". */
  window_amount: string;
  /** Length of that rolling window in seconds, e.g. 86400 for 24h. */
  window_seconds: number;
  /** ISO 8601 instant. */
  expires_at: string;
  principal: MandatePrincipal;
}

/**
 * The read-only seam a future mandate writer would satisfy. Implementations must return `null` for a
 * serial they do not know and throw only for an outage — "not found" and "could not read" are
 * different answers and must not collapse into the same one.
 */
export interface MandateSource {
  get(serial: string): Promise<MandateRecord | null> | MandateRecord | null;
}

/**
 * A serial is either the short code the pass face renders (`vch-` + exactly three alphanumerics) or the
 * full serial (`vch_` + at least 22 URL-safe characters, i.e. >=128 bits of randomness). Strict on
 * purpose: a loose path segment turns this route into a directory probe, and the proposal is explicit
 * that serials must be unguessable. `vch-ABC123` is not accepted as a serial; it is a short code with
 * the wrong width.
 */
export const MANDATE_SERIAL_RE = /^(?:vch-[A-Za-z0-9]{3}|vch_[A-Za-z0-9_-]{22,64})$/;

export interface MandateResponse {
  serial: string;
  status: MandateStatus;
  scope: {
    per_payment: string;
    window_amount: string;
    window_seconds: number;
    expires_at: string;
  } | null;
  principal: MandatePrincipal | null;
  verdict_for_seller: SellerVerdict;
  /** When this answer was computed. In the body so a verifier can tell live from stale even without headers. */
  as_of: string;
}

/** A serial we do not know is still a complete answer: unknown status, unknown verdict, no scope. */
export function unknownMandate(serial: string, asOf: string): MandateResponse {
  return {
    serial,
    status: "unknown",
    scope: null,
    principal: null,
    verdict_for_seller: "unknown",
    as_of: asOf,
  };
}

/**
 * Turn a stored record into the public answer.
 *
 * Expiry is evaluated here, not trusted from the row: a record written as `active` whose `expires_at`
 * has passed is `expired`, and a malformed expiry fails closed to `expired` rather than reading as
 * live. Revocation outranks expiry — a revoked mandate stays revoked after it expires.
 */
export function mandateResponse(record: MandateRecord, asOf: string): MandateResponse {
  const expiresAtMs = Date.parse(record.expires_at);
  const expired =
    record.status === "expired" || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.parse(asOf);
  const status: MandateStatus =
    record.status === "revoked" ? "revoked" : expired ? "expired" : "active";

  return {
    serial: record.serial,
    status,
    scope: {
      per_payment: record.per_payment,
      window_amount: record.window_amount,
      window_seconds: record.window_seconds,
      expires_at: record.expires_at,
    },
    principal: record.principal,
    verdict_for_seller: status === "active" ? "trust" : "do_not_trust",
    as_of: asOf,
  };
}

export function createMandateRoutes(source: MandateSource | undefined): Hono {
  const routes = new Hono();

  routes.get("/v1/mandate/:serial", async (c) => {
    const serial = c.req.param("serial");
    const asOf = new Date().toISOString();

    if (!MANDATE_SERIAL_RE.test(serial)) {
      return c.json(PROBLEMS.invalidSerial(serial), 400);
    }

    // No source is configured in this deployment. Say so in the body by answering `unknown` for every
    // serial — never 503, because "we do not keep mandates" is a fact, not an outage, and never a
    // fabricated active record.
    if (source === undefined) {
      return c.json(unknownMandate(serial, asOf), 200, { "cache-control": "no-store, max-age=0" });
    }

    let record: MandateRecord | null;
    try {
      record = await source.get(serial);
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "mandate_read_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      // A failed read must not be reported as `unknown`: that would say "no such mandate" when the
      // truthful answer is "could not check". Fail closed with a retriable 503 instead.
      return c.json(PROBLEMS.mandateSourceUnavailable(), 503);
    }

    if (record === null) {
      return c.json(unknownMandate(serial, asOf), 200, { "cache-control": "no-store, max-age=0" });
    }

    return c.json(mandateResponse(record, asOf), 200, {
      "cache-control": "no-store, max-age=0",
    });
  });

  return routes;
}
