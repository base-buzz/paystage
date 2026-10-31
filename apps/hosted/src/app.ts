import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.js";
import { evaluateRoutes } from "./routes/evaluate.js";
import { publicStatusRoutes } from "./routes/public-status.js";
import { recordEvent, sourceFromHeaders } from "./telemetry.js";
import { CORS_ORIGINS } from "./cors-origins.js";
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
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface CreateAppOptions {
  facilitatorClient?: FacilitatorClient;
  protect?: boolean;
}

function nonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.length > 0;
}

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
  "X-Paystage-Source",
  "x-paystage-source",
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

// Map request path -> telemetry tool name. Returns null to skip telemetry.
function toolFromPath(path: string): string | null {
  if (path === "/" || path.startsWith("/health")) return null;
  if (path === "/v1/evaluate_mcp_payment") return "evaluate_mcp_payment";
  if (path === "/v1/evaluate_outstanding_auths")
    return "evaluate_outstanding_auths";
  if (path === "/v1/public/status") return null;
  // Fallback: strip leading slash and slashes -> underscores.
  const trimmed = path.replace(/^\/+/, "").replace(/\/+/g, "_");
  return trimmed.length > 0 ? trimmed : null;
}

interface ParsedDecision {
  decision: string;
  reason_codes: string[];
}

// Best-effort parse of a JSON response body for decision + reason_codes.
async function parseDecisionFromResponse(
  res: Response,
): Promise<ParsedDecision | null> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) return null;
  try {
    const clone = res.clone();
    const data = (await clone.json()) as unknown;
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;
    const decision =
      typeof obj.decision === "string"
        ? obj.decision
        : typeof obj.verdict === "string"
          ? obj.verdict
          : null;
    if (!decision) return null;
    const reason_codes = Array.isArray(obj.reason_codes)
      ? (obj.reason_codes as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    return { decision, reason_codes };
  } catch {
    return null;
  }
}

function classifyStatus(status: number): {
  facilitator_status: string | null;
  error_class: string | null;
} {
  if (status >= 500) {
    return { facilitator_status: null, error_class: "internal_error" };
  }
  if (status === 402) {
    return { facilitator_status: "payment_required", error_class: null };
  }
  if (status >= 400) {
    return { facilitator_status: null, error_class: "client_error" };
  }
  return { facilitator_status: null, error_class: null };
}

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

  // Structured request/response logs + telemetry (no bodies, no secrets).
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-paystage-request-id") || null;
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const tool = toolFromPath(path);
    const source = sourceFromHeaders(c.req);
    const network = env.PAYSTAGE_NETWORK ?? "eip155:8453";

    console.log(
      JSON.stringify({
        level: "info",
        msg: "request",
        requestId,
        method,
        path,
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

    let threw = false;
    try {
      await next();
    } catch (err) {
      threw = true;
      console.log(
        JSON.stringify({
          level: "error",
          msg: "request_throw",
          requestId,
          method,
          path,
          error: err instanceof Error ? err.message : String(err),
          network: env.PAYSTAGE_NETWORK ?? null,
        }),
      );
      throw err;
    } finally {
      const durationMs = Date.now() - start;
      const status = threw ? 500 : c.res.status;

      console.log(
        JSON.stringify({
          level: "info",
          msg: "response",
          requestId,
          method,
          path,
          status,
          durationMs,
          network: env.PAYSTAGE_NETWORK ?? null,
        }),
      );

      // Telemetry: skip OPTIONS, health, and non-tool paths.
      if (method !== "OPTIONS" && tool !== null) {
        const parsed = threw ? null : await parseDecisionFromResponse(c.res);
        const decision = parsed ? parsed.decision : String(status);
        const reason_codes = parsed ? parsed.reason_codes : [];
        const { facilitator_status, error_class } = classifyStatus(status);

        let waitUntil: ((p: Promise<unknown>) => void) | undefined;
        try {
          const ctx = c.executionCtx;
          if (ctx && typeof ctx.waitUntil === "function") {
            waitUntil = (p) => ctx.waitUntil(p);
          }
        } catch {
          // executionCtx may throw when not running on CF; ignore.
          waitUntil = undefined;
        }

        recordEvent(
          {
            SUPABASE_URL: env.SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
          },
          {
            source,
            tool,
            decision,
            reason_codes,
            network,
            latency_ms: durationMs,
            request_id: requestId,
            facilitator_status,
            error_class,
          },
          waitUntil,
        );
      }
    }
  });

  // Short-circuit OPTIONS in case payment middleware would otherwise run.
  app.options("*", (c) => c.body(null, 204));

  app.route("/", healthRoutes);

  // Public status feed — must be mounted BEFORE payment middleware.
  app.route("/", publicStatusRoutes);

  const protect = opts.protect ?? true;
  if (protect) {
    app.use("*", buildPaymentMiddleware(cfg, opts.facilitatorClient));
  }

  app.route("/", evaluateRoutes);

  return app;
}
