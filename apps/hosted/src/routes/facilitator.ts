/**
 * The public facilitator HTTP surface: `GET /supported`, `POST /verify`, `POST /settle`.
 *
 * x402 v2 vocabulary only. The body is the protocol's own `VerifyRequest` / `SettleRequest`
 * (`{ x402Version, paymentPayload, paymentRequirements }`), and the response is the
 * protocol's `VerifyResponse` / `SettleResponse`. No `X-PAYMENT-*` header is read or written
 * here: those are the v1 spelling, and a v2 facilitator that echoes them confuses clients
 * about which version they are speaking.
 *
 * Both POST endpoints return HTTP 200 for a well-formed request, including a payment the
 * facilitator rejects (`isValid: false` / `success: false`). A 4xx means the *request* was
 * malformed, not that the payment was refused — that distinction is what lets an agent tell
 * "fix the body" from "this payment is no good".
 *
 * ## `/supported` answers in every mode, and says which mode it is in
 *
 * `GET /supported` is the discovery document every x402 facilitator exposes; its shape is
 * `SupportedResponse` from `@x402/core` — `{ kinds: SupportedKind[], extensions, signers }`,
 * with `SupportedKind = { x402Version, scheme, network, extra? }`. We copied the envelope
 * from that type and from a real response (`https://x402.org/facilitator/supported`,
 * captured 2026-11-28), not invented one.
 *
 * It returns **200 in all three states**, unlike `/verify`/`/settle`, which return 503
 * whenever there is no local client. That is deliberate: a monitor needs to be able to tell
 *
 *   - `cdp` — `FACILITATOR_MODE` is not `self`; this host is not a facilitator and does not
 *     settle for anyone (the address on chain is Coinbase's, not ours);
 *   - `self-unconfigured` — mode is `self` but no gas key is loaded: **configured but
 *     refusing**, the state this endpoint exists to make visible;
 *   - `self` — mode is `self` and the gas signer is loaded: verify/settle are live.
 *
 * from `404 /supported` (the feature is not deployed). The state is carried in the
 * `x-paystage-facilitator` response header rather than as a new JSON field, because
 * `SupportedResponse` has no state field and a discovery document that invented one would
 * no longer be the protocol's document.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SupportedResponse,
} from "@x402/core/types";
import { USDC_BY_NETWORK } from "../self-facilitator.js";
import { VERIFIER_STATEMENT } from "../x402.js";

/** The three deployment states `/supported` distinguishes. */
export type FacilitatorState = "self" | "self-unconfigured" | "cdp";

export interface FacilitatorRouteOptions {
  /**
   * The in-process facilitator client. `null` means self-facilitator mode is not configured
   * (missing gas key, or `FACILITATOR_MODE=cdp`): the endpoints answer 503 rather than
   * pretending to verify with a different facilitator.
   */
  client: FacilitatorClient | null;
  /** Why `client` is null, surfaced to an operator without leaking configuration. */
  unavailableReason?: string;
  /**
   * The base discovery document, built from the facilitator or from config. Lazily called
   * because the package's `getSupported()` is async.
   */
  supported: () => SupportedResponse | Promise<SupportedResponse>;
  /** Which configuration this process is in; sent as the `x-paystage-facilitator` header. */
  state: FacilitatorState;
}

/**
 * Adds PayStage's own two facts to the package's discovery document.
 *
 * `SupportedKind` has no `asset` field, and the verifier statement is PayStage metadata, so
 * both ride in `extra` — the protocol's open `Record<string, unknown>` extension slot, and
 * the same slot the 402 challenge already uses for `extra.verifier` (see `x402.ts`). No
 * top-level key is added: a discovery document with a sibling `asset` would not match
 * `SupportedResponse` and indexers that validate the document may drop it.
 *
 * `extra.verifier` is identical to the object on `accepts[].extra.verifier`: one statement
 * about who verifies, with which key and under what terms, so a client that read either
 * document sees the same words.
 */
export function withFacilitatorExtras(
  supported: SupportedResponse,
  network: string,
): SupportedResponse {
  const asset = USDC_BY_NETWORK[network];
  return {
    ...supported,
    kinds: supported.kinds.map((kind) => ({
      ...kind,
      extra: {
        ...kind.extra,
        ...(asset ? { asset } : {}),
        verifier: VERIFIER_STATEMENT,
      },
    })),
  };
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

  /**
   * `GET /supported` — the discovery document a facilitator registry points at.
   *
   * The body is exactly `SupportedResponse` from `@x402/core`: `{ kinds, extensions, signers }`
   * with `SupportedKind = { x402Version, scheme, network, extra? }`. Nothing is added at the
   * top level — `configured` and a bare `x402Version` are *not* in that type, and an indexer
   * that validates the document may drop or reject them. The mode is a header instead:
   * `x-paystage-facilitator: self | self-unconfigured | cdp` (see the module comment above).
   *
   * `kinds` is what this deployment accepts when it settles; `signers` is the gas address the
   * package reports from the live signer, and stays `{}` until one is loaded, because a signer
   * address we cannot settle from would be a lie with a checksum.
   */
  app.get("/supported", async (c) => {
    c.header("cache-control", "no-store");
    c.header("x-paystage-facilitator", opts.state);
    return c.json(await opts.supported(), 200);
  });

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
