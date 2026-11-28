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
    /**
     * Idempotency, advertised so a buyer can actually use it.
     *
     * The dedup logic shipped on 2026-11-19 — `paymentIdentifier` in preflight, seven tests, LIMITS 6b — and no buyer could reach it, because a challenge that does not declare the
     * extension tells a client not to bother sending an id. A capability nobody is told about is not a capability.
     *
     * The declaration follows the x402 payment-identifier extension: the server advertises support here, the client sends a stable id with the payload, and a repeat of an id we have
     * already judged returns `review` rather than a second approval.
     */
    "payment-identifier": {
      required: false,
      description:
        "Send a stable id with a payment and retries of it are deduplicated: a second verdict for the same id inside ten minutes is review, not a second pay.",
      ttl_seconds: 600,
    },
    // Human-readable summary shown by explorers that render it.
    summary,
  };
}

/**
 * Compact descriptions are deliberate (#484): `PAYMENT-REQUIRED` must stay under 2,048
 * bytes (#494), and the verifier statement is worth more to a buyer than indexer prose that
 * repeats itself. Each field below still says what it is.
 */
const PAYMENT_BODY_SCHEMA = {
  type: "object",
  required: ["payment_required", "policy"],
  properties: {
    payment_required: { type: "object", description: "Decoded x402 challenge" },
    policy: { type: "object", description: "Spend policy" },
    agent_id: { type: "string", description: "Optional agent id" },
  },
};

/**
 * Who verifies the payment, by what key, under what terms, and where the result can be
 * re-checked (#484).
 *
 * A 402 can say who *will* verify, which a block explorer cannot: the chain says who
 * settled, afterwards. This is that statement, carried on every accepts[] entry because it
 * describes that entry's payment terms.
 *
 * **It lives in `extra`, not at the top level.** `PaymentRequirements.extra` is the
 * protocol's own extension slot (`Record<string, unknown>` in `@x402/core`), it is merged
 * through `buildPaymentRequirementsFromOptions` and `ExactEvmScheme`, and it survives
 * `structuredClone` on the response path. A sibling key such as `accepts[].verifier` is not
 * in the PaymentRequirements schema; clients that validate the document may drop or reject
 * it, and x402scan-style indexers only read the documented fields.
 *
 * **It states the limit in the challenge.** `covers` says *authority, not delivery or
 * quality*: the gate checks that the payer authorised this payee, asset and amount until a
 * deadline. It does not check whether what was bought was any good. A buyer must not infer
 * more, and a gate that implies more is lying.
 *
 * Values are absolute URLs that resolve on the live deployment:
 *  - `key` — the published receipt JWKS (rotation is additive; receipts name a `kid`);
 *  - `terms` — the human-readable statement on the docs page, same wording as this object;
 *  - `recheck` — the public evidence bundle for a past run, with `?format=receipt` for the
 *    signed receipt. `{id}` is the content-addressed bundle id (SHA-256 of the inputs).
 */
export const VERIFIER_STATEMENT = {
  who: "PayStage",
  key: "https://api.paystage.xyz/.well-known/paystage-receipt-key.json",
  terms: "https://paystage.xyz/docs#verify",
  recheck: "https://api.paystage.xyz/runs/{id}?format=receipt",
  covers:
    "authority, not delivery or quality: it checks the payment was authorised, not that what was bought was any good",
} as const;

/** One payment option with the verifier attached. All paid routes share it. */
function paymentOption(cfg: X402Config) {
  return {
    scheme: "exact",
    price: cfg.price,
    network: cfg.network,
    payTo: cfg.payTo,
    extra: { verifier: VERIFIER_STATEMENT },
  };
}

/**
 * The paid-only alias (#150).
 *
 * Bazaar indexes an endpoint after it answers a *paid* call, and its crawler arrives with a fresh IP — which our free tier
 * greets with 200. The alias is the same handler with no free path, so an unlabelled caller always gets a 402 and the crawler
 * sees an x402 route. The free tier stays exactly as it is: it is the product, not the bug.
 */
export const PAID_ALIAS = "/v1/paid/evaluate_mcp_payment";

export function buildRoutesConfig(cfg: X402Config) {
  return {
    [`POST ${PAID_ALIAS}`]: {
      accepts: [paymentOption(cfg)],
      description: "Paid-only alias",
      mimeType: "application/json",
      extensions: bazaarInfo("Sign this payment?", PAYMENT_BODY_SCHEMA),
    },
    "POST /v1/evaluate_mcp_payment": {
      accepts: [paymentOption(cfg)],
      description: "Evaluate an MCP payment",
      mimeType: "application/json",
      extensions: bazaarInfo("Sign this payment?", PAYMENT_BODY_SCHEMA),
    },
    "POST /v1/evaluate_outstanding_auths": {
      accepts: [paymentOption(cfg)],
      description: "Evaluate EIP-3009 auths",
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
