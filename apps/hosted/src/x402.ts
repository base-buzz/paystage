import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { withStaticSupported } from "./facilitator-cache.js";
import type { MiddlewareHandler } from "hono";

export interface FacilitatorAuth {
  apiKeyId: string;
  apiKeySecret: string;
}

export interface X402Config {
  payTo: string;
  price: string;
  network: string;
  facilitatorUrl: string;
  facilitatorAuth?: FacilitatorAuth;
}

export interface FacilitatorClient {
  // Minimal shape used by x402ResourceServer; tests can inject a mock.
  [key: string]: unknown;
}

export const PROTECTED_ROUTES = [
  "POST /v1/evaluate_mcp_payment",
  "POST /v1/evaluate_outstanding_auths",
] as const;

/**
 * The x402 client types describe an interface with an index signature, which a class
 * instance does not structurally satisfy even though it implements the same methods.
 * One named alias beats scattering `as never` at each call site, and keeps the cast
 * local rather than at every usage.
 */
type ClientLike = FacilitatorClient & Record<string, unknown>;

export function buildResourceServer(
  cfg: X402Config,
  facilitatorClient?: FacilitatorClient,
): x402ResourceServer {
  let client: FacilitatorClient;
  if (facilitatorClient) {
    // Injected (tests).
    client = facilitatorClient;
  } else if (cfg.facilitatorAuth) {
    // Mainnet: Coinbase CDP facilitator with auth headers.
    const config = createFacilitatorConfig(
      cfg.facilitatorAuth.apiKeyId,
      cfg.facilitatorAuth.apiKeySecret,
    );
    client = new HTTPFacilitatorClient(config as never) as unknown as ClientLike;
  } else {
    // Testnet: x402.org facilitator (no auth).
    client = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl } as never) as unknown as ClientLike;
  }

  // Cache the facilitator's supported-kinds answer at the edge, so a cold isolate
  // does not pay a network round trip on the request path. Injected clients (tests)
  // are left untouched.
  // Cache first (avoids the round trip on a warm colo). The deadline fallback is
  // built but OFF by default: a static supported-kind answer initialised the server
  // and then failed later in the request (500s instead of 503s) because the exact
  // scheme needs fields the facilitator normally supplies. Enable only once that
  // shape is known to be complete.
  // The supported-kinds answer comes from config, not from the facilitator. A burst of
  // cold isolates used to queue behind a discovery round trip and hit the 5s guard;
  // paying is unaffected because verify/settle still delegate to the real client.
  const routed = facilitatorClient
    ? client
    : withStaticSupported(client as object, { network: cfg.network, scheme: "exact" });

  const server = new x402ResourceServer(routed as never);
  server.register(cfg.network as `${string}:${string}`, new ExactEvmScheme());
  return server;
}

/**
 * The input schema an indexer needs to invoke this route.
 *
 * x402scan's spec is explicit: a route with no input schema is listed as non-invocable and skipped.
 * The schema is the request body we already accept, so it is derived from the same shape rather than
 * hand-written twice.
 */
function bazaarInfo(summary: string, bodySchema: Record<string, unknown>) {
  return {
    bazaar: {
      info: {
        input: {
          type: "http",
          method: "POST",
          bodyType: "json",
          body: bodySchema,
        },
        output: { type: "json" },
      },
    },
    // Human-readable summary shown by explorers that render it.
    summary,
  };
}

const PAYMENT_BODY_SCHEMA = {
  type: "object",
  required: ["payment_required", "policy"],
  properties: {
    payment_required: {
      type: "object",
      description: "The decoded x402 challenge the agent is considering signing",
    },
    policy: { type: "object", description: "The spend policy to evaluate it against" },
    agent_id: { type: "string", description: "Optional identifier for per-agent budgets" },
  },
};

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
      extensions: bazaarInfo("Should this x402 payment be signed?", PAYMENT_BODY_SCHEMA),
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
      extensions: bazaarInfo(
        "Which outstanding EIP-3009 authorisations need attention?",
        {
          type: "object",
          required: ["auths", "policy"],
          properties: {
            auths: { type: "array", description: "Outstanding authorisations to evaluate" },
            policy: { type: "object", description: "The spend policy to evaluate them against" },
          },
        },
      ),
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
  return paymentMiddleware(
    routes as unknown as Parameters<typeof paymentMiddleware>[0],
    server,
    undefined,
    undefined,
    true,
  );
}
