/**
 * `GET /supported` is the discovery endpoint a facilitator registry points at (x402scan's
 * list is a hardcoded table of URLs, so a URL without this route cannot be listed at all).
 *
 * Two properties matter and both are asserted here: the body is the protocol's own
 * `SupportedResponse` — `{ kinds, extensions, signers }`, nothing else — and the endpoint
 * answers **200 in every mode**, so a monitor can tell "configured but refusing"
 * (`x-paystage-facilitator: self-unconfigured`) from "this host is not a facilitator"
 * (`cdp`) without confusing either with "the route is not deployed" (404).
 */
import { describe, expect, it } from "vitest";

import type { SupportedResponse } from "@x402/core/types";
import {
  createFacilitatorRoutes,
  withFacilitatorExtras,
} from "../src/routes/facilitator.js";
import { USDC_BY_NETWORK } from "../src/self-facilitator.js";
import { VERIFIER_STATEMENT } from "../src/x402.js";

const NETWORK = "eip155:8453";
const GAS = "0x680228D4915ad9f46C1cF72e1D80370b56a42405";

/** The base document the package's `getSupported()` produces for one exact/Base kind. */
function baseSupported(): SupportedResponse {
  return {
    kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
    extensions: [] as string[],
    signers: {} as Record<string, string[]>,
  };
}

function app(state: "self" | "self-unconfigured" | "cdp", client: unknown, signers = {}) {
  return createFacilitatorRoutes({
    client: client as never,
    state,
    supported: () =>
      withFacilitatorExtras(
        {
          ...baseSupported(),
          signers: signers as Record<string, string[]>,
        },
        NETWORK,
      ),
  });
}

async function get(state: "self" | "self-unconfigured" | "cdp", client: unknown) {
  return app(state, client).request("/supported", { method: "GET" });
}

describe("GET /supported", () => {
  it("answers 200 with no facilitator loaded and names the state", async () => {
    const response = await get("self-unconfigured", null);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-paystage-facilitator")).toBe("self-unconfigured");
  });

  it("answers 200 in cdp mode too, and says cdp", async () => {
    const response = await get("cdp", null);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-paystage-facilitator")).toBe("cdp");
  });

  it("returns exactly the protocol's SupportedResponse shape", async () => {
    const response = await get("self", { verify: async () => ({}), settle: async () => ({}) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // No `configured`, no bare `x402Version`: those are not fields of SupportedResponse.
    expect(Object.keys(body).sort()).toEqual(["extensions", "kinds", "signers"]);
    expect(body.extensions).toEqual([]);
    expect(body.signers).toEqual({});
  });

  it("advertises the configured network, USDC and the verifier statement", async () => {
    const response = await get("self", { verify: async () => ({}), settle: async () => ({}) });
    const body = (await response.json()) as {
      kinds: Array<{ x402Version: number; scheme: string; network: string; extra?: Record<string, unknown> }>;
    };
    expect(body.kinds).toHaveLength(1);
    const kind = body.kinds[0]!;
    expect(kind).toMatchObject({ x402Version: 2, scheme: "exact", network: NETWORK });
    expect(kind.extra?.asset).toBe(USDC_BY_NETWORK[NETWORK]);
    expect(kind.extra?.verifier).toEqual(VERIFIER_STATEMENT);
    // Still no non-protocol top-level key.
    expect(Object.keys(kind).sort()).toEqual(["extra", "network", "scheme", "x402Version"]);
  });

  it("publishes the signer address the facilitator reports, under the package's family key", async () => {
    const response = await app("self", { verify: async () => ({}), settle: async () => ({}) }, {
      "eip155:*": [GAS],
    }).request("/supported", { method: "GET" });
    const body = (await response.json()) as { signers: Record<string, string[]> };
    expect(body.signers).toEqual({ "eip155:*": [GAS] });
  });

  it("is never cached: the configured state changes when an operator flips a variable", async () => {
    const response = await get("cdp", null);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
