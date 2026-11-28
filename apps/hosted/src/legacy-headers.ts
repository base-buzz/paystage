import type { MiddlewareHandler } from "hono";

/**
 * v2 vocabulary only (#484).
 *
 * We emit `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, never the
 * launch-era `X-` spellings. A client still sending the old `X-PAYMENT` header is accepted:
 * the value is copied onto `PAYMENT-SIGNATURE` before the gate reads it, and the request log
 * records which spelling arrived so we can see who is still on the old form rather than
 * silently dropping them.
 *
 * The copy is a new `Request` because request headers are immutable. It happens before body
 * parsing, so the handler still sees the original stream. `X-PAYMENT-RESPONSE` cannot arrive
 * on a request in practice; if it does, it is logged and otherwise ignored.
 */
export function legacyPaymentHeaderMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const legacyPayment = c.req.header("x-payment");
    const legacyResponse = c.req.header("x-payment-response");
    if (legacyPayment !== undefined || legacyResponse !== undefined) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "legacy_payment_header_seen",
          path: c.req.path,
          seen: [
            ...(legacyPayment !== undefined ? ["x-payment"] : []),
            ...(legacyResponse !== undefined ? ["x-payment-response"] : []),
          ],
          emitted: "PAYMENT-SIGNATURE",
        }),
      );
    }

    if (legacyPayment !== undefined && c.req.header("payment-signature") === undefined) {
      const headers = new Headers(c.req.raw.headers);
      headers.set("payment-signature", legacyPayment);
      c.req.raw = new Request(c.req.raw, { headers });
    }

    await next();
  };
}
