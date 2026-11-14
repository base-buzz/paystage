import { NextResponse } from "next/server";

/**
 * The apex copy of `/openapi.json`.
 *
 * Directories check the domain you give them, and we give them the apex. The paths are on the API
 * host because that is where payments settle — this document says so in `servers`, which is the
 * OpenAPI-correct way to point at another host rather than pretending the routes live here.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

const PRICE = "0.002";
const NETWORK = "eip155:8453";

const VERDICT = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["pay", "review", "do_not_pay"] },
    reasons: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

const op = (summary: string, description: string, props: Record<string, unknown>) => ({
  post: {
    summary,
    description,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", required: ["policy"], properties: props },
        },
      },
    },
    responses: {
      "200": { description: "A verdict. Free-tier calls answer this without payment.", content: { "application/json": { schema: VERDICT } } },
      "402": {
        description: "Payment required; the challenge travels in the Payment-Required header.",
        headers: { "Payment-Required": { schema: { type: "string" } } },
      },
    },
    "x-payment-info": { protocols: ["x402"], network: NETWORK, price: { mode: "fixed", currency: "USD", amount: PRICE } },
  },
});

export function GET() {
  return NextResponse.json(
    {
      openapi: "3.1.0",
      info: {
        title: "PayStage",
        version: "2026.11.14",
        description:
          "Read-only preflight for x402 payments: pay / review / do_not_pay before anything is signed. Never signs, never holds a key.",
        contact: { url: "https://paystage.xyz" },
      },
      servers: [{ url: "https://api.paystage.xyz" }],
      paths: {
        "/v1/evaluate_mcp_payment": op(
          "Evaluate MCP payment",
          "Judge one x402 payment against a spend policy before the agent signs it.",
          {
            payment_required: { type: "object", description: "The decoded x402 challenge" },
            policy: { type: "object", description: "The spend policy" },
            agent_id: { type: "string" },
          },
        ),
        "/v1/evaluate_outstanding_auths": op(
          "Evaluate outstanding auths",
          "Judge outstanding EIP-3009 / Permit2 authorisations against a spend policy.",
          { auths: { type: "array", items: { type: "object" } }, policy: { type: "object" } },
        ),
      },
      security: [],
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
