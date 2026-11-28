import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.js";
import { createEvaluateRoutes } from "./routes/evaluate.js";
import { publicStatusRoutes } from "./routes/public-status.js";
import { receiptKeyRoutes } from "./routes/receipt-key.js";
import { PROBLEMS } from "./problem.js";
import { publicChainRoutes } from "./routes/public-chain.js";
import { wellKnownRoutes } from "./routes/well-known.js";
import { wellKnownMcpRoutes } from "./routes/well-known-mcp.js";
import { guardVerdictRoutes } from "./routes/guard-verdict.js";
import { openapiRoutes } from "./routes/openapi.js";
import { createRunsRoutes } from "./routes/runs.js";
import { createWalletsRoutes } from "./routes/wallets.js";
import { createMandateRoutes, type MandateSource } from "./routes/mandate.js";
import { createRollupRoutes } from "./routes/rollup.js";
import { supabaseRollupStore, type RollupStore } from "./rollup-store.js";
import {
  createMandateMintRoutes,
  type MandateMintOptions,
  type VerificationKey,
} from "./routes/mandate-mint.js";
import { publishedReceiptJwks } from "./routes/receipt-key.js";
import { supabaseMandateStore, type MandateStore } from "./mandate-store.js";
import { BUNDLE_STORE_VAR, supabaseBundleStore, type BundleStore } from "./bundle-store.js";
import {
  supabasePayeeObservationStore,
  type PayeeObservationStore,
} from "./payee-observation-store.js";
import { clientFromHeaders, provenanceFromHeaders, provenanceKeyFrom, recordEvent, sourceFromHeaders } from "./telemetry.js";
import { payerFromPaymentHeader } from "./paid-quota.js";
import { channelMiddleware } from "./channel.js";
import { consumeFreeTierCall, freeTierMiddleware, secondsUntilFreeTierReset } from "./free-tier.js";
import { paidQuotaMiddleware, paidQuotaState } from "./paid-quota.js";
import { settlementCaptureMiddleware } from "./settlement.js";
import { curatedOverCapBody, mcpHandler } from "./mcp.js";
import { CORS_ORIGINS } from "./cors-origins.js";
import { DRIP_USDC, WINDOW_HOURS, handleFaucet } from "./faucet.js";
import {
  buildPaymentMiddleware,
  type FacilitatorAuth,
  type FacilitatorClient,
  type X402Config,
} from "./x402.js";
import { legacyPaymentHeaderMiddleware } from "./legacy-headers.js";
import {
  USDC_BY_NETWORK,
  createSelfFacilitator,
  signerFromPrivateKey,
  usdToAtomic,
  type SelfFacilitatorClient,
} from "./self-facilitator.js";
import { createFacilitatorRoutes } from "./routes/facilitator.js";
import type { FacilitatorEvmSigner } from "@x402/evm";

export interface AppEnv {
  PAYSTAGE_PAYTO: string;
  PAYSTAGE_PRICE?: string;
  PAYSTAGE_NETWORK?: string;
  FACILITATOR_URL?: string;
  /** `self` runs our own facilitator; unset/`cdp` keeps the Coinbase CDP facilitator. */
  FACILITATOR_MODE?: string;
  /** Gas-wallet private key for `FACILITATOR_MODE=self`. Worker secret; never logged. */
  FACILITATOR_GAS_PRIVATE_KEY?: string;
  PAID_QUOTA_ENABLED?: string;
  PAID_QUOTA_DAILY_LIMIT?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** PKCS#8 base64 ECDSA P-256 key. Unset = receipts are emitted unsigned. */
  RECEIPT_SIGNING_KEY_PKCS8?: string;
  /** Key id the active signing key stamps. Rotation is additive; see `receipt-key.ts`. */
  RECEIPT_SIGNING_KEY_ID?: string;
  /** `kid:pkcs8` pairs, comma-separated, for keys rotated out while their receipts still verify. */
  RECEIPT_SIGNING_KEYS_RETIRED?: string;
  /**
   * #455: the service token that may mint a mandate (`POST /v1/mandate`). Unset/empty means every
   * mint is refused with `mandate_mint_not_configured`: minting is a write of authority, so there is
   * no open default.
   */
  MANDATE_MINT_TOKEN?: string;
  /** #455: the tenant every minted row belongs to. Deployment configuration, never a request field. */
  MANDATE_TENANT_ID?: string;
  /** Free tier for callers with no payment and no account. Default on. */
  FREE_TIER_ENABLED?: string;
  FREE_TIER_DAILY_LIMIT?: string;
}

/** Context variables set by middleware and read further down the stack. */
type Variables = {
  paystageFree: boolean;
  bundleStore: BundleStore | undefined;
  /** Listing channel for this request (#326); null is unknown, never "direct". */
  channel: string | null;
};

export interface CreateAppOptions {
  facilitatorClient?: FacilitatorClient;
  /**
   * Test seam for the self facilitator's gas signer. Production builds the signer from
   * `FACILITATOR_GAS_PRIVATE_KEY`; tests pass a stub so no key or RPC is involved.
   */
  facilitatorSigner?: FacilitatorEvmSigner;
  protect?: boolean;
  /** Test/deployment seam for evidence-bundle storage; defaults to the Supabase store. */
  bundleStore?: BundleStore;
  /** Test/deployment seam for payee-observation storage; defaults to the Supabase store. */
  payeeObservationStore?: PayeeObservationStore;
  /**
   * Test/deployment seam for mandate reads. Defaults to the Supabase store (#453) when both
   * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured; with none the route answers
   * `unknown` for every serial rather than inventing one.
   */
  mandateSource?: MandateSource;
  /**
   * Test/deployment seam for mandate writes (#455). Defaults to the same Supabase store the read
   * route uses; a test that injects a memory store gets both halves pointed at it.
   */
  mandateStore?: MandateStore;
  /**
   * Test seam for the mint route's owner, tenant and verification key set. Defaults to
   * `MANDATE_MINT_TOKEN`, `MANDATE_TENANT_ID` and the published receipt key set derived from
   * `RECEIPT_SIGNING_KEY_PKCS8` / `RECEIPT_SIGNING_KEYS_RETIRED`.
   */
  mandateMint?: Partial<Omit<MandateMintOptions, "store">>;
  /**
   * Test/deployment seam for the org-unit roll-up (#471). Defaults to the Supabase store when both
   * bindings are set; with none the route answers 503 rather than an invented zero total.
   */
  rollupStore?: RollupStore;
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
  // #430: a browser-based caller must be able to send its signed provenance without a failed preflight.
  "X-Paystage-Provenance",
  "x-paystage-provenance",
  "X-Paystage-Provenance-Sig",
  "x-paystage-provenance-sig",
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
// Strict allowlist only — never record robots/sitemap/favicon/static as tools.
export function toolFromPath(path: string): string | null {
  switch (path) {
    case "/v1/evaluate_mcp_payment":
    case "/v1/paid/evaluate_mcp_payment":
      // The alias is telemetry's `evaluate_mcp_payment` too: a settled call there is the same product, and reporting it as a
      // different tool would make the paid-only path look like a separate offering in every chart.
      return "evaluate_mcp_payment";
    case "/v1/evaluate_outstanding_auths":
      return "evaluate_outstanding_auths";
    default:
      return null;
  }
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

export function facilitatorMode(env: AppEnv): "self" | "cdp" {
  return env.FACILITATOR_MODE === "self" ? "self" : "cdp";
}

export function createApp(env: AppEnv, opts: CreateAppOptions = {}): Hono<{ Variables: Variables }> {
  const mode = facilitatorMode(env);
  const facilitatorAuth: FacilitatorAuth | undefined =
    mode === "cdp" && nonEmpty(env.CDP_API_KEY_ID) && nonEmpty(env.CDP_API_KEY_SECRET)
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

  /**
   * Self-facilitator selection. `FACILITATOR_MODE=self` never falls back to CDP: if the gas
   * key is missing the paid routes fail closed and the public endpoints answer 503, because
   * a deployment that says "self" and silently spends Coinbase's facilitator is a lie about
   * who settled the payment.
   */
  let selfFacilitator: SelfFacilitatorClient | null = null;
  let selfUnavailableReason: string | undefined;
  if (mode === "self") {
    const signer =
      opts.facilitatorSigner ??
      (nonEmpty(env.FACILITATOR_GAS_PRIVATE_KEY)
        ? signerFromPrivateKey(env.FACILITATOR_GAS_PRIVATE_KEY, cfg.network)
        : null);
    if (signer) {
      selfFacilitator = createSelfFacilitator({
        signer,
        policy: {
          payTo: cfg.payTo,
          network: cfg.network,
          asset: USDC_BY_NETWORK[cfg.network],
          minimumAmount: usdToAtomic(cfg.price),
        },
      });
    } else {
      selfUnavailableReason = "FACILITATOR_MODE=self is set but FACILITATOR_GAS_PRIVATE_KEY is not.";
    }
  } else {
    selfUnavailableReason = "FACILITATOR_MODE is not self.";
  }

  /**
   * A self-mode app with no signer still has to answer. It advertises the local kind so the
   * resource server can build a challenge, then refuses every verify/settle: an explicit
   * failure, never a quiet delegation to someone else's facilitator.
   */
  const unconfiguredSelf: FacilitatorClient | undefined =
    mode === "self" && !selfFacilitator
      ? {
          getSupported: async () => ({
            kinds: [
              {
                x402Version: 2,
                scheme: "exact",
                network: cfg.network as `${string}:${string}`,
              },
            ],
            extensions: [],
            signers: {},
          }),
          verify: async () => ({ isValid: false, invalidReason: "facilitator_not_configured" }),
          settle: async () => ({
            success: false,
            errorReason: "facilitator_not_configured",
            transaction: "",
            network: cfg.network as `${string}:${string}`,
          }),
        }
      : undefined;

  const app = new Hono<{ Variables: Variables }>();
  const bundleStore = opts.bundleStore ?? supabaseBundleStore(env);
  const payeeObservationStore =
    opts.payeeObservationStore ?? supabasePayeeObservationStore(env);
  // One store instance serves both halves: the public read (#453) and the mint writer (#455), so an
  // injected memory store in a test is read back by the same route the production store is.
  const mandateStore = opts.mandateStore ?? supabaseMandateStore(env);
  const mandateSource = opts.mandateSource ?? mandateStore;
  // The roll-up (#471) reads the same table but a different column set; it gets its own seam so a test
  // can exercise subtree aggregation without a database.
  const rollupStore = opts.rollupStore ?? supabaseRollupStore(env);
  app.use("*", async (c, next) => {
    c.set(BUNDLE_STORE_VAR, bundleStore);
    await next();
  });

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

  // Channel attribution must run before the request logger/telemetry: the event row records the channel
  // resolved from this request's `?from=`, and the first touch is remembered in a session cookie.
  app.use("*", channelMiddleware());

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
    // Provenance is proven by a signed header, never inferred. `unknown` is not "external" (#430).
    const callerProvenance = await provenanceFromHeaders(c.req, provenanceKeyFrom(env));
    // Attributed by SDK build, never by caller identity (#52): this is what turns npm download counts into "which
    // installed version is actually being called".
    const client = clientFromHeaders(c.req);
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

      /**
       * The payer on a **refusal** (#489).
       *
       * A `do_not_pay` never settles, so there is no receipt to read a payer from — which is why `payer` was null on all 836 refusals
       * and the question a manager asks ("who was stopped?") had no answer. But the caller has usually already sent a payment
       * signature, and its `authorization.from` is readable *before* verification: that is the wallet claiming to pay.
       *
       * It is recorded as **claimed, not proven** — the column holds the same value a settled row would, and the row's
       * `caller_provenance` still says whether anything vouched for the caller. Inventing nothing: when no signature is present, the
       * payer stays null and the page says "not supplied" rather than guessing.
       */
      const claimedPayer =
        payerFromPaymentHeader(
          c.req.header("payment-signature") ??
            c.req.header("PAYMENT-SIGNATURE") ??
            c.req.header("x-payment") ??
            c.req.header("X-PAYMENT") ??
            null,
        ) ?? null;

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
            payer: claimedPayer,
            network,
            latency_ms: durationMs,
            request_id: requestId,
            client_package: client.package,
            client_version: client.version,
            channel: c.get("channel") ?? null,
            caller_provenance: callerProvenance,
            facilitator_status,
            error_class,
          },
          waitUntil,
        );
      }
    }
  });

  // Server-Timing on every response, so any caller can measure this service
  // without trusting our published numbers. Mounted before the payment
  // middleware so the header survives a 402 as well as a 200.
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    const dur = performance.now() - started;
    c.header("Server-Timing", `app;dur=${dur.toFixed(1)}`);
  });

  // Short-circuit OPTIONS in case payment middleware would otherwise run.
  app.options("*", (c) => c.body(null, 204));

  app.route("/", healthRoutes);

  // The public facilitator surface. Mounted before the payment gate and the free tier: these
  // endpoints verify/settle *other* requests, they are not themselves a paid route. In CDP
  // mode they answer 503 rather than proxying, so the answer says who actually settles.
  app.route(
    "/",
    createFacilitatorRoutes({
      client: selfFacilitator,
      ...(selfUnavailableReason !== undefined
        ? { unavailableReason: selfUnavailableReason }
        : {}),
    }),
  );

  // Public status feed — must be mounted BEFORE payment middleware.
  app.route("/", publicStatusRoutes);
  app.route("/", receiptKeyRoutes);
  app.route("/", publicChainRoutes);
  app.route("/", wellKnownRoutes);
  app.route("/", wellKnownMcpRoutes);
  app.route("/", guardVerdictRoutes);
  app.route("/", openapiRoutes);
  // Public and read-only: checking a past decision is not a new payment.
  const runsRoutes = createRunsRoutes(bundleStore);
  app.route("/", runsRoutes);
  // Public and read-only: a category is a list of observations, not a paid evaluation.
  const walletsRoutes = createWalletsRoutes(payeeObservationStore);
  app.route("/", walletsRoutes);
  // Public and read-only: a QR scan asks whether an authority still exists, not for a new evaluation.
  // Mounted before the payment gate on purpose (#423).
  const mandateRoutes = createMandateRoutes(mandateSource);
  app.route("/", mandateRoutes);
  // A roll-up is a read (#471): public, read-only, and mounted before the payment gate. No permission
  // model lives here; who may see a tree is a separate session's design.
  app.route("/", createRollupRoutes({ store: rollupStore }));
  // The mint (#455) is the write half of the same record: not a paid evaluation, and gated by a
  // service token rather than by x402, so it is mounted outside the payment middleware too.
  const mandateMintRoutes = createMandateMintRoutes({
    store: mandateStore,
    token: opts.mandateMint?.token ?? env.MANDATE_MINT_TOKEN,
    tenantId: opts.mandateMint?.tenantId ?? env.MANDATE_TENANT_ID,
    verificationKeys:
      opts.mandateMint?.verificationKeys ??
      (() =>
        publishedReceiptJwks(
          env as unknown as Record<string, string | undefined>,
        ) as unknown as Promise<VerificationKey[]>),
    now: opts.mandateMint?.now,
  });
  app.route("/", mandateMintRoutes);

  const protect = opts.protect ?? true;
  if (protect) {
    // Fail fast, never hang. The x402 middleware performs facilitator discovery on
    // a cold isolate, and that discovery retries with backoff when the facilitator
    // rate-limits. Observed 2026-11-09: a burst of unpaid requests eventually left
    // one hanging past 30 s with no response. A caller waiting on a socket is the
    // worst failure mode for an agent; a 503 it can retry from is the good one.
    const UPSTREAM_GUARD_MS = Number((cfg as { upstreamGuardMs?: number }).upstreamGuardMs ?? 5000);
    app.use("*", async (c, next) => {
      const started = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const guard = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), UPSTREAM_GUARD_MS);
      });
      try {
        const winner = await Promise.race([next().then(() => "done" as const), guard]);
        if (winner === "timeout") {
          // Say why. A guard that swallows the reason is untraceable from outside,
          // which is exactly the hole that cost an afternoon of guessing.
          const cache = await import("./facilitator-cache.js");
          const elapsed = performance.now() - started;
          c.header(
            "x-paystage-debug",
            `upstream_timeout source=${cache.supportedSource() ?? "none"} calls=${cache.supportedCallCount()} elapsed_ms=${elapsed.toFixed(0)}`,
          );
          return c.json(PROBLEMS.upstreamTimeout(), 503);
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    });
    // The testnet faucet needs no payment and must not be behind the payment middleware: its whole purpose is to let
    // someone try the paid path who has no testnet funds yet. Mounted before the free tier and quota so a faucet call
    // does not consume an evaluation allowance (#92).
    app.post("/faucet", async (c) => {
      const result = await handleFaucet(c.req.raw, env);
      return c.json(result.body, result.status as 200 | 400 | 429 | 502 | 503);
    });
    app.get("/faucet", (c) =>
      c.json({
        drip: { amountUsdc: DRIP_USDC, perAddressPerHours: WINDOW_HOURS },
        method: "POST",
        body: { address: "0x…" },
        network: "eip155:84532 (Base Sepolia)",
        note: "one drip per address per 24h; the response says when it resets",
      }),
    );

    // Accept launch-era header spellings on input, and log which arrived (#484). Before the
    // free tier and the quota so both see the same `payment-signature` the gate will read.
    app.use("*", legacyPaymentHeaderMiddleware());

    // Free tier first: a caller without a payment signature may still be served, up to a
    // daily per-IP allowance. Marked on the context so the payment middleware steps aside
    // instead of answering 402 to a caller we already agreed to serve.
    app.use("*", freeTierMiddleware({
      enabled: env.FREE_TIER_ENABLED !== "false",
      dailyLimit: Number(env.FREE_TIER_DAILY_LIMIT ?? 1000),
    }));

    // Before the payment middleware, because the quota must answer before any money moves. A limit that
    // fires after settlement would take the payment and refuse the work.
    app.use("*", paidQuotaMiddleware({
      enabled: env.PAID_QUOTA_ENABLED !== "false",
      dailyLimit: Number(env.PAID_QUOTA_DAILY_LIMIT ?? 5000),
    }));

    // The capture has to WRAP the payment middleware, not sit inside it. Registered after, it runs
    // before the response leaves payMw — so `PAYMENT-RESPONSE` does not exist yet and every real
    // settlement was recorded as payer:null. Proven on the first mainnet payment: 0.002 USDC moved,
    // the receipt echoed the payer, and the row still said null.
    app.use("*", settlementCaptureMiddleware());

    const payMw = buildPaymentMiddleware(
      cfg,
      opts.facilitatorClient ?? selfFacilitator ?? unconfiguredSelf,
    );
    app.use("*", (c, next) => (c.get("paystageFree") === true ? next() : payMw(c, next)));
  }

  app.route("/", createEvaluateRoutes({ mandateSource }));

  // Remote MCP endpoint. Mounted outside the payment gate on purpose: the gate protects the
  // *evaluation* service, and an MCP client that cannot complete an x402 handshake still
  // needs to discover tools. The evaluation itself runs with the caller's own policy.
  const mcp = mcpHandler(env, { bundleStore });
  app.all("/mcp", (c) => mcp.fetch(c.req.raw));

  // ChatGPT-facing curated surface (#442): the same handlers filtered to the read-only payment
  // tools (gate, decode, verify). `/mcp` keeps all ten, writers included. This path sits behind
  // the same per-instance free allowance as the evaluation paths; past the cap it answers with a
  // body that names the cap and the paid path instead of a bare 402/429, because a ChatGPT client
  // cannot pay in-chat and a bare 402 reads as an outage to its user.
  const curatedMcp = mcpHandler(env, { bundleStore, surface: "curated" });
  app.all("/mcp/chatgpt", async (c) => {
    const gate = consumeFreeTierCall(c.req.raw, {
      enabled: env.FREE_TIER_ENABLED !== "false",
      dailyLimit: Number(env.FREE_TIER_DAILY_LIMIT ?? 1000),
    });
    if (!gate.allowed) {
      const retryAfter = secondsUntilFreeTierReset();
      c.header("retry-after", String(retryAfter));
      c.header("x-paystage-free-tier", gate.reason);
      return c.json(curatedOverCapBody(gate.limit, retryAfter, gate.reason), 429);
    }
    c.header("x-paystage-free-tier", gate.counted ? "free" : "uncounted");
    if (gate.counted) c.header("x-paystage-free-remaining", String(gate.remaining));
    return curatedMcp.fetch(c.req.raw);
  });

  return app;
}
