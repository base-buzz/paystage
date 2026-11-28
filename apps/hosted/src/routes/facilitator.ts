/**
 * The public facilitator HTTP surface: `POST /verify` and `POST /settle`.
 *
 * x402 v2 vocabulary only. The body is the protocol's own `VerifyRequest` / `SettleRequest`
 * (`{ x402Version, paymentPayload, paymentRequirements }`), and the response is the
 * protocol's `VerifyResponse` / `SettleResponse`. No `X-PAYMENT-*` header is read or written
 * here: those are the v1 spelling, and a v2 facilitator that echoes them confuses clients
 * about which version they are speaking.
 *
 * Both endpoints return HTTP 200 for a well-formed request, including a payment the
 * facilitator rejects (`isValid: false` / `success: false`). A 4xx means the *request* was
 * malformed, not that the payment was refused — that distinction is what lets an agent tell
 * "fix the body" from "this payment is no good".
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

export interface FacilitatorRouteOptions {
  /**
   * The in-process facilitator client. `null` means self-facilitator mode is not configured
   * (missing gas key, or `FACILITATOR_MODE=cdp`): the endpoints answer 503 rather than
   * pretending to verify with a different facilitator.
   */
  client: FacilitatorClient | null;
  /** Why `client` is null, surfaced to an operator without leaking configuration. */
  unavailableReason?: string;
}

interface ParsedBody {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the v2 request. Accepts only the v2 field names; the v1 `paymentHeader` /
 * `paymentRequirements` pair is deliberately not accepted, because silently translating it
 * would make the endpoint look like it speaks v1 and hide a client that needs upgrading.
 */
function parseBody(body: unknown): ParsedBody | { error: string; detail: string } {
  if (!isObject(body)) {
    return { error: "invalid_request", detail: "Body must be a JSON object." };
  }
  if (body.x402Version !== undefined && body.x402Version !== 2) {
    return {
      error: "unsupported_version",
      detail: "This facilitator speaks x402 v2 only; set x402Version to 2.",
    };
  }
  const paymentPayload = body.paymentPayload;
  const paymentRequirements = body.paymentRequirements;
  if (!isObject(paymentPayload)) {
    return { error: "invalid_request", detail: "paymentPayload must be an object." };
  }
  if (!isObject(paymentRequirements)) {
    return { error: "invalid_request", detail: "paymentRequirements must be an object." };
  }
  if (!isObject(paymentPayload.accepted)) {
    return {
      error: "invalid_request",
      detail: "paymentPayload.accepted must be a PaymentRequirements object.",
    };
  }
  if (!isObject(paymentPayload.payload)) {
    return { error: "invalid_request", detail: "paymentPayload.payload must be an object." };
  }
  if (paymentPayload.x402Version !== 2) {
    return {
      error: "unsupported_version",
      detail: "paymentPayload.x402Version must be 2.",
    };
  }
  return {
    paymentPayload: paymentPayload as unknown as PaymentPayload,
    paymentRequirements: paymentRequirements as unknown as PaymentRequirements,
  };
}

export function createFacilitatorRoutes(opts: FacilitatorRouteOptions): Hono {
  const app = new Hono();

  const unavailable = (c: Context) => {
    return c.json(
      {
        error: "facilitator_not_configured",
        detail:
          opts.unavailableReason ??
          "This deployment is not running its own facilitator. Set FACILITATOR_MODE=self and the gas-wallet secret.",
      },
      503,
    );
  };

  app.post("/verify", async (c) => {
    c.header("cache-control", "no-store");
    if (!opts.client) return unavailable(c);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "invalid_json", detail: "The request body could not be parsed as JSON." },
        400,
      );
    }

    const parsed = parseBody(body);
    if ("error" in parsed) return c.json(parsed, 400);

    const result = await opts.client.verify(
      parsed.paymentPayload,
      parsed.paymentRequirements,
    );
    return c.json(result, 200);
  });

  app.post("/settle", async (c) => {
    c.header("cache-control", "no-store");
    if (!opts.client) return unavailable(c);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "invalid_json", detail: "The request body could not be parsed as JSON." },
        400,
      );
    }

    const parsed = parseBody(body);
    if ("error" in parsed) return c.json(parsed, 400);

    const result = await opts.client.settle(
      parsed.paymentPayload,
      parsed.paymentRequirements,
    );
    return c.json(result, 200);
  });

  return app;
}
