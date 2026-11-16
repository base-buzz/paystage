/**
 * Per-payer quota on the paid path.
 *
 * The item asked for "per-key quotas"; there are no keys. Paid access is per-call over x402, so the identity
 * that can abuse the endpoint is the paying wallet, and the limit belongs there.
 *
 * The payer is read from the payment signature the caller already sent — before verification, and therefore
 * before any charge. That ordering is the whole point: a quota that fires after settlement would take money
 * and refuse the work.
 *
 * If the payer cannot be read, the request continues: an unreadable header is verified (or rejected) by the
 * x402 middleware, and a quota must never be the thing that decides whether a malformed request is free.
 */
import type { MiddlewareHandler } from "hono";

type Bucket = { day: number; used: number };

const DAY_MS = 86_400_000;
/** Per-isolate counters, like the free tier. A distributed limit needs a store; this is a speed bump. */
const buckets = new Map<string, Bucket>();

export type PaidQuotaConfig = { dailyLimit?: number; enabled?: boolean };

/** Read `from` out of an x402 payment signature without verifying it. Verification is not this function's job. */
export function payerFromPaymentHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      payload?: { authorization?: { from?: string } };
      authorization?: { from?: string };
    };
    const from = decoded.payload?.authorization?.from ?? decoded.authorization?.from;
    return typeof from === "string" && /^0x[0-9a-fA-F]{40}$/.test(from) ? from.toLowerCase() : null;
  } catch {
    return null;
  }
}

export const paidQuotaState = { limit: 5000, refused: 0 };

/** Clear the per-isolate counters. Exists for tests: shared module state otherwise leaks between cases. */
export function resetPaidQuota(): void {
  buckets.clear();
  paidQuotaState.refused = 0;
}

export function paidQuotaMiddleware(cfg: PaidQuotaConfig = {}): MiddlewareHandler {
  const enabled = cfg.enabled ?? true;
  const limit = cfg.dailyLimit ?? 5000;
  paidQuotaState.limit = limit;

  return async (c, next) => {
    if (!enabled || c.req.method !== "POST") return next();

    const header =
      c.req.header("payment-signature") ?? c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("x-payment");
    const payer = payerFromPaymentHeader(header);
    // No payment header means this is the free tier's business, not the quota's.
    if (payer === null) return next();

    const today = Math.floor(Date.now() / DAY_MS);
    const bucket = buckets.get(payer);
    const used = bucket && bucket.day === today ? bucket.used : 0;

    if (used >= limit) {
      paidQuotaState.refused += 1;
      const retryAfter = Math.ceil((DAY_MS - (Date.now() % DAY_MS)) / 1000);
      c.header("retry-after", String(retryAfter));
      c.header("x-paystage-paid-quota", "exhausted");
      return c.json(
        {
          error: "paid_quota_exceeded",
          message: `this payer has used ${used} of ${limit} paid calls today`,
          limit,
          retry_after_seconds: retryAfter,
        },
        429,
      );
    }

    buckets.set(payer, { day: today, used: used + 1 });
    c.header("x-paystage-paid-quota-remaining", String(limit - used - 1));
    return next();
  };
}
