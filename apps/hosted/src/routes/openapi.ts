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

/**
 * The error shape, as a schema — RFC 9457 plus the fields an agent needs to recover (#problem-details).
 *
 * Documented here rather than only implemented, because an agent reads this document before its first call: a 400 with
 * no declared schema is a 400 the client library will surface as an opaque string.
 */
const PROBLEM_SCHEMA = {
  type: "object",
  required: ["type", "title", "status", "detail", "error", "is_retriable"],
  properties: {
    type: { type: "string", format: "uri", description: "A URL naming this error class, e.g. https://paystage.xyz/errors/invalid_json" },
    title: { type: "string", description: "Short summary, safe to show a human" },
    status: { type: "integer", description: "The HTTP status, repeated in the body" },
    detail: { type: "string", description: "What went wrong, specific to this request" },
    error: { type: "string", description: "Stable machine name for the error class; safe to switch on" },
    is_retriable: {
      type: "boolean",
      description:
        "Whether retrying the SAME request could ever succeed. False for wrong input — fix the field named below instead of retrying.",
    },
    retry_after_seconds: {
      type: "integer",
      description: "Present only when is_retriable is true. Wait this long, then retry.",
    },
    field: { type: "string", description: "The request parameter that caused the failure, when there is one" },
    fix: { type: "string", description: "The change to make in the next call, in the imperative" },
    instance: { type: "string", description: "The request id, so a report can be matched to a log line" },
  },
  examples: [
    {
      type: "https://paystage.xyz/errors/missing_payment_required",
      title: "payment_required is required",
      status: 400,
      detail: "The body has no payment_required object, so there is no payment to judge.",
      error: "missing_payment_required",
      is_retriable: false,
      field: "payment_required",
      fix: "Pass the decoded x402 challenge: the object a server returned under `accepts` in its 402 response.",
    },
  ],
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
        "400": {
          description:
            "The body or the policy was rejected. The cause is named in `field`; `is_retriable` is false because the same body will fail the same way.",
          content: { "application/problem+json": { schema: PROBLEM_SCHEMA } },
        },
        "429": {
          description: "Daily quota for this caller is spent. `retry_after_seconds` says when it resets.",
          content: { "application/problem+json": { schema: PROBLEM_SCHEMA } },
        },
        "503": {
          description: "The payment facilitator did not answer in time. Retriable after `retry_after_seconds`.",
          content: { "application/problem+json": { schema: PROBLEM_SCHEMA } },
        },
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
    /**
     * The paid-only alias (#150). It is documented as its own operation because its purpose is different — an indexer or
     * crawler probing it must see a challenge, and a caller that needs the free tier should use the canonical path.
     */
    "/v1/paid/evaluate_mcp_payment": paidOperation(
      "Paid-only alias of evaluate_mcp_payment",
      "Identical evaluation to /v1/evaluate_mcp_payment, at a path that always answers 402 to an unpaid caller. " +
        "Use it if you are a directory or crawler that discovers x402 endpoints by requiring a challenge: the canonical " +
        "path may answer 200 from the free tier, and an indexer that only indexes challenging endpoints would skip it. " +
        "Do NOT use it to avoid the free tier — the free tier exists so an agent can get a verdict without paying, and " +
        "the canonical path is the one documented for agents.",
      PAYMENT_BODY,
    ),
    "/v1/evaluate_mcp_payment": paidOperation(
      "Evaluate one x402 payment against a spend policy",
      "Use this immediately before signing any x402 payment: it returns pay, review or do_not_pay with the rule that " +
        "fired. Do NOT use it to inspect outstanding allowances (use /v1/evaluate_outstanding_auths) or to verify a " +
        "receipt (use verify_receipt in the MCP package). It never signs, never moves funds and has no side effects, so " +
        "a refusal costs nothing. " +
        "payment_required is the decoded x402 v2 challenge — the object the seller returned under `accepts`, with " +
        "amount in ATOMIC units as a decimal string (12500000 = 12.5 USDC at 6 decimals). " +
        "policy is a version 1 policy document; validate it first with validate_policy, because an invalid policy makes " +
        "every evaluation refuse with a 400 and that looks like an outage. " +
        "Order matters when the policy has per-agent budgets: pass agent_id, or the per-agent rules are unreachable.",
      PAYMENT_BODY,
    ),
    "/v1/evaluate_outstanding_auths": paidOperation(
      "Judge outstanding ERC-20 / Permit2 / EIP-3009 authorisations",
      "Use this when an agent already holds approvals and you need to know which are dangerous before the next payment " +
        "— unlimited allowances, expired authorisations, spenders that are not on the allow-list. Do NOT use it to " +
        "revoke anything: it reports, and revocation is a transaction the caller sends. " +
        "auths is the array returned by list_outstanding_auths; passing a hand-built array works but must match that " +
        "shape (spender, amount as an atomic decimal string, expiry as a unix timestamp in seconds). " +
        "Call list_outstanding_auths first when the caller does not already hold that array.",
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
