import { Hono } from "hono";

/**
 * `GET /openapi.json` — x402scan's first-choice discovery path.
 *
 * Their spec reads OpenAPI before `/.well-known/x402`, and marks the well-known file a compatibility
 * fallback. Ours returned a valid document there and their register form still said "No discovery
 * document found", so this is the format they actually check: `x-payment-info` per paid operation,
 * a declared 402 response, and pricing in USD.
 *
 * It is also better for humans and agents than a bespoke file — an OpenAPI document can be loaded into
 * any client, and the request schema is the same one the route accepts.
 */
export const openapiRoutes = new Hono();

const PRICE = "0.002";
const NETWORK = "eip155:8453";

const PAYMENT_BODY = {
  type: "object",
  required: ["payment_required", "policy"],
  properties: {
    payment_required: { type: "object", description: "The decoded x402 challenge being considered" },
    policy: { type: "object", description: "The spend policy to evaluate it against" },
    agent_id: { type: "string", description: "Optional agent identifier for per-agent budgets" },
  },
} as const;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["pay", "review", "do_not_pay"] },
    reasons: { type: "array", items: { type: "string" } },
    acceptResults: { type: "array", items: { type: "object" } },
    summary: { type: "string" },
  },
} as const;

function paidOperation(summary: string, description: string, bodySchema: unknown) {
  return {
    post: {
      summary,
      description,
      operationId: summary.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      requestBody: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
      responses: {
        "200": {
          description: "A verdict. Free-tier calls answer this without payment.",
          content: { "application/json": { schema: VERDICT_SCHEMA } },
        },
        "402": {
          description:
            "Payment required. The challenge travels in the Payment-Required header; the free tier " +
            "answers 200 first for callers without a payment signature.",
          headers: {
            "Payment-Required": {
              description: "base64-encoded x402 v2 PaymentRequired object",
              schema: { type: "string" },
            },
          },
        },
      },
      // The field x402scan reads to decide this operation is payable and at what price.
      "x-payment-info": {
        protocols: ["x402"],
        network: NETWORK,
        price: { mode: "fixed", currency: "USD", amount: PRICE },
      },
    },
  };
}

export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "PayStage",
    version: "2026.11.14",
    description:
      "Read-only preflight for x402 payments. Returns pay / review / do_not_pay before anything is " +
      "signed, with the rule that fired. Never signs and never holds a key.",
    contact: { url: "https://paystage.xyz", email: "basebuzz69@gmail.com" },
  },
  servers: [{ url: "https://api.paystage.xyz" }],
  paths: {
    "/v1/evaluate_mcp_payment": paidOperation(
      "Evaluate MCP payment",
      "Judge one x402 payment against a spend policy before the agent signs it.",
      PAYMENT_BODY,
    ),
    "/v1/evaluate_outstanding_auths": paidOperation(
      "Evaluate outstanding auths",
      "Judge outstanding EIP-3009 / Permit2 authorisations against a spend policy.",
      {
        type: "object",
        required: ["auths", "policy"],
        properties: {
          auths: { type: "array", items: { type: "object" }, description: "Authorisations to evaluate" },
          policy: { type: "object" },
        },
      },
    ),
  },
  // No auth: an agent cannot fill in a signup form, which is why the free tier exists.
  security: [],
};

openapiRoutes.get("/openapi.json", (c) =>
  c.json(OPENAPI_DOCUMENT, 200, {
    "cache-control": "public, max-age=3600",
    "access-control-allow-origin": "*",
  }),
);
