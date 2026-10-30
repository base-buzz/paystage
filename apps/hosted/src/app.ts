import { Hono } from "hono";
import { healthRoutes } from "./routes/health.js";
import { evaluateRoutes } from "./routes/evaluate.js";
import {
  buildPaymentMiddleware,
  type FacilitatorClient,
  type X402Config,
} from "./x402.js";

export interface AppEnv {
  PAYSTAGE_PAYTO: string;
  PAYSTAGE_PRICE?: string;
  PAYSTAGE_NETWORK?: string;
  FACILITATOR_URL?: string;
}

export interface CreateAppOptions {
  facilitatorClient?: FacilitatorClient;
  protect?: boolean;
}

export function createApp(env: AppEnv, opts: CreateAppOptions = {}): Hono {
  const cfg: X402Config = {
    payTo: env.PAYSTAGE_PAYTO,
    price: env.PAYSTAGE_PRICE ?? "$0.002",
    network: env.PAYSTAGE_NETWORK ?? "eip155:84532",
    facilitatorUrl: env.FACILITATOR_URL ?? "https://x402.org/facilitator",
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
