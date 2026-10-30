import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { MiddlewareHandler } from "hono";

export interface X402Config {
  payTo: string;
  price: string;
  network: string;
  facilitatorUrl: string;
}

export interface FacilitatorClient {
  // Minimal shape used by x402ResourceServer; tests can inject a mock.
  [key: string]: unknown;
}

export const PROTECTED_ROUTES = [
  "POST /v1/evaluate_mcp_payment",
  "POST /v1/evaluate_outstanding_auths",
] as const;

export function buildResourceServer(
  cfg: X402Config,
  facilitatorClient?: FacilitatorClient,
): x402ResourceServer {
  const client =
    facilitatorClient ??
    new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
  const server = new x402ResourceServer(client as never);
  server.register(cfg.network, new ExactEvmScheme());
  return server;
}

export function buildRoutesConfig(cfg: X402Config) {
  return {
    "POST /v1/evaluate_mcp_payment": {
      accepts: [
        {
          scheme: "exact",
          price: cfg.price,
          network: cfg.network,
          payTo: cfg.payTo,
        },
      ],
      description: "Evaluate MCP payment against spend policy",
      mimeType: "application/json",
    },
    "POST /v1/evaluate_outstanding_auths": {
      accepts: [
        {
          scheme: "exact",
          price: cfg.price,
          network: cfg.network,
          payTo: cfg.payTo,
        },
      ],
      description: "Evaluate outstanding EIP-3009 authorizations against spend policy",
      mimeType: "application/json",
    },
  };
}

export function buildPaymentMiddleware(
  cfg: X402Config,
  facilitatorClient?: FacilitatorClient,
): MiddlewareHandler {
  const server = buildResourceServer(cfg, facilitatorClient);
  const routes = buildRoutesConfig(cfg);
  // Workers: do not sync facilitator on start (no long-lived process).
  return paymentMiddleware(routes, server, undefined, undefined, true);
}
