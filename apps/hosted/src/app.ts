import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.js";
import { evaluateRoutes } from "./routes/evaluate.js";
import {
  buildPaymentMiddleware,
  type FacilitatorAuth,
  type FacilitatorClient,
  type X402Config,
} from "./x402.js";

export interface AppEnv {
  PAYSTAGE_PAYTO: string;
  PAYSTAGE_PRICE?: string;
  PAYSTAGE_NETWORK?: string;
  FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

export interface CreateAppOptions {
  facilitatorClient?: FacilitatorClient;
  protect?: boolean;
}

function nonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.length > 0;
}

const CORS_ORIGINS = [
  "https://paystage.xyz",
  "https://www.paystage.xyz",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

// Include access-control-expose-headers because @x402/fetch wrongly sets it
// as a REQUEST header on the paid retry, which triggers a CORS preflight.
const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Accept",
  "Payment-Signature",
  "PAYMENT-SIGNATURE",
  "payment-signature",
  "X-PAYMENT",
  "x-payment",
  "Access-Control-Expose-Headers",
  "access-control-expose-headers",
  "X-Paystage-Request-Id",
  "x-paystage-request-id",
];

const CORS_EXPOSE_HEADERS = [
  "Payment-Required",
  "Payment-Response",
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "X-PAYMENT-RESPONSE",
  "payment-required",
  "payment-response",
  "X-Paystage-Request-Id",
  "x-paystage-request-id",
];

export function createApp(env: AppEnv, opts: CreateAppOptions = {}): Hono {
  const facilitatorAuth: FacilitatorAuth | undefined =
    nonEmpty(env.CDP_API_KEY_ID) && nonEmpty(env.CDP_API_KEY_SECRET)
      ? { apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET }
      : undefined;

  const cfg: X402Config = {
    payTo: env.PAYSTAGE_PAYTO,
    price: env.PAYSTAGE_PRICE ?? "$0.002",
    // Mainnet default; Sepolia is selected via PAYSTAGE_NETWORK.
    network: env.PAYSTAGE_NETWORK ?? "eip155:8453",
    // Only used when no CDP credentials are present (testnet).
    facilitatorUrl: env.FACILITATOR_URL ?? "https://x402.org/facilitator",
    facilitatorAuth,
  };

  const app = new Hono();

  // CORS must be first so preflight is answered before payment middleware.
  app.use(
    "*",
    cors({
      origin: CORS_ORIGINS,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: CORS_ALLOW_HEADERS,
      exposeHeaders: CORS_EXPOSE_HEADERS,
      maxAge: 86400,
    }),
  );

  // Echo correlating request id on every response (incl. 4xx/5xx).
  app.use("*", async (c, next) => {
    const rid = c.req.header("x-paystage-request-id");
    if (rid) c.header("x-paystage-request-id", rid);
    await next();
  });

  // Structured request/response logs (no bodies, no secrets).
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-paystage-request-id") || null;
    const start = Date.now();
    console.log(
      JSON.stringify({
        level: "info",
        msg: "request",
        requestId,
        method: c.req.method,
        path: c.req.path,
        origin: c.req.header("origin") || null,
        hasPaymentSignature: !!(
          c.req.header("payment-signature") ||
          c.req.header("PAYMENT-SIGNATURE") ||
          c.req.header("x-payment") ||
          c.req.header("X-PAYMENT")
        ),
        network: env.PAYSTAGE_NETWORK ?? null,
      }),
    );
    try {
      await next();
    } catch (err) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "request_throw",
          requestId,
          method: c.req.method,
          path: c.req.path,
          error: err instanceof Error ? err.message : String(err),
          network: env.PAYSTAGE_NETWORK ?? null,
        }),
      );
      throw err;
    }
    console.log(
      JSON.stringify({
        level: "info",
        msg: "response",
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - start,
        network: env.PAYSTAGE_NETWORK ?? null,
      }),
    );
  });

  // Short-circuit OPTIONS in case payment middleware would otherwise run.
  app.options("*", (c) => c.body(null, 204));

  app.route("/", healthRoutes);

  const protect = opts.protect ?? true;
  if (protect) {
    app.use("*", buildPaymentMiddleware(cfg, opts.facilitatorClient));
  }

  app.route("/", evaluateRoutes);

  return app;
}
