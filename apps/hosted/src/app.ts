import { Hono } from "hono";
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

  app.route("/", healthRoutes);

  const protect = opts.protect ?? true;
  if (protect) {
    app.use("*", buildPaymentMiddleware(cfg, opts.facilitatorClient));
  }

  app.route("/", evaluateRoutes);

  return app;
}
