/**
 * Free tier: a stranger's agent can get a real verdict without paying and without signing
 * up, because an agent cannot complete an OAuth flow or a card form. Every competitor with
 * a hosted endpoint will serve those callers first; this is how we do not lose them at step
 * one. Owner-approved 2026-11-12.
 *
 * Limit: 1000 evaluations per IP per day. Counted in isolate memory, which means the real
 * ceiling is 1000 × (number of warm isolates) — generous by design. A precise global counter
 * needs a Durable Object or KV, and at current volume the over-allowance costs nothing while
 * a wrong hard stop would lose the exact caller we are trying to win.
 *
 * Free calls are labelled `free-tier` in telemetry, never as paid customers.
 */

import type { MiddlewareHandler } from "hono";
import { recordEvent } from "./telemetry.js";

const DAY_MS = 86_400_000;
const FREE_PATHS = new Set([
  "/v1/evaluate_mcp_payment",
  "/v1/evaluate_payment",
  "/v1/evaluate_trade",
]);

type Bucket = { day: number; used: number };

/** Per-isolate counters. Keyed by client IP. */
const buckets = new Map<string, Bucket>();

export type FreeTierConfig = {
  enabled?: boolean;
  dailyLimit?: number;
};

export function freeTierMiddleware(cfg: FreeTierConfig = {}): MiddlewareHandler {
  const enabled = cfg.enabled ?? true;
  const limit = cfg.dailyLimit ?? 1000;

  return async (c, next) => {
    if (!enabled || c.req.method !== "POST" || !FREE_PATHS.has(c.req.path)) return next();

    // Test hook: `x-paystage-force-payment: 1` opts a *synthetic* caller out of the free tier so the
    // settlement path can be exercised on demand. Without it, a funded wallet can never pay from an
    // IP that still has free calls left — which is how our first "paid" probe silently cost nothing
    // and returned no PAYMENT-RESPONSE. Scoped to `source=synthetic` so a real caller cannot skip
    // paying, and labelled in telemetry like every other synthetic call.
    const forcePayment = c.req.header("x-paystage-force-payment") === "1";
    const synthetic = c.req.header("x-paystage-source") === "synthetic";
    if (forcePayment && synthetic) {
      c.header("x-paystage-free-tier", "forced-paid");
      return next();
    }

    // A caller that brings a payment signature is a paid call, not a free one.
    const hasPayment =
      c.req.header("payment-signature") ||
      c.req.header("x-payment") ||
      c.req.header("PAYMENT-SIGNATURE") ||
      c.req.header("X-PAYMENT");
    if (hasPayment) return next();

    // A request that is not an evaluation must not consume a free call, and must not answer 200/400
    // either — it should reach the payment challenge.
    //
    // x402scan's discovery spec lists this as a known failure: "Expected 402, got 400 from request
    // validation running before payment challenge". An indexer probes with an empty body, so a free
    // tier that answers first makes the endpoint look like it is not an x402 route at all, and it gets
    // skipped. The same logic protects real callers: a typo in the body should not burn a free call.
    if (c.req.path !== "/mcp") {
      let looksLikeEvaluation = false;
      try {
        const body = await c.req.raw.clone().json() as Record<string, unknown>;
        looksLikeEvaluation =
          typeof body === "object" &&
          body !== null &&
          ("payment_required" in body || "auths" in body || "payments" in body) &&
          "policy" in body;
      } catch {
        looksLikeEvaluation = false;
      }
      if (!looksLikeEvaluation) {
        c.header("x-paystage-free-tier", "not-an-evaluation");
        return next();
      }
    }

    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    const today = Math.floor(Date.now() / DAY_MS);
    const bucket = buckets.get(ip);
    const used = bucket && bucket.day === today ? bucket.used : 0;

    if (used >= limit) {
      // Out of free calls: fall through to the paid path, which answers 402 with the
      // challenge. A caller that cannot pay gets a clear reason rather than a hard block.
      c.header("x-paystage-free-tier", "exhausted");
      return next();
    }

    buckets.set(ip, { day: today, used: used + 1 });
    c.set("paystageFree", true);
    c.header("x-paystage-free-tier", "free");
    c.header("x-paystage-free-remaining", String(limit - used - 1));

    await next();

    // Label it, do not hide it: a free-tier call is a real caller who did not pay.
    // Wrapped because telemetry must never be able to fail a request — it did, once, by
    // reading a binding that is absent in tests.
    let waitUntil: ((p: Promise<unknown>) => void) | undefined;
    try {
      waitUntil = (p) => c.executionCtx?.waitUntil?.(p);
    } catch {
      waitUntil = undefined;
    }
    try {
      recordEvent(
        (c.env ?? {}) as never,
        {
        source: "free-tier",
        tool: c.req.path.replace("/v1/", ""),
        decision: c.res.status >= 400 ? "error" : "free",
        reason_codes: [],
        network: c.env?.PAYSTAGE_NETWORK ?? null,
          request_id: c.req.header("x-paystage-request-id") ?? null,
        } as never,
        waitUntil,
      );
    } catch (error) {
      console.log(JSON.stringify({ level: "warn", msg: "free_tier_telemetry_failed", detail: String(error) }));
    }
  };
}

/** Test seam: clear the counters between cases. */
export function resetFreeTierBuckets(): void {
  buckets.clear();
}
