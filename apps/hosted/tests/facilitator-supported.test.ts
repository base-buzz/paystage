/**
 * `GET /supported` is the discovery endpoint a facilitator registry points at (x402scan's list is a hardcoded table of
 * URLs, so a URL without this route cannot be listed at all). Two properties matter and both are asserted here: the shape
 * is the protocol's own `SupportedResponse`, and the endpoint answers **200 in both modes** — "configured and refusing" and
 * "not there" are different facts, and a monitor must be able to tell them apart.
 */
import { describe, expect, it } from "vitest";

import { createFacilitatorRoutes } from "../src/routes/facilitator.js";

const call = async (client: unknown) => {
  const app = createFacilitatorRoutes({ client: client as never, unavailableReason: "not configured in this test" });
  return app.request("/supported", { method: "GET" });
};

describe("GET /supported", () => {
  it("answers 200 even when the facilitator is not configured, and says so", async () => {
    const response = await call(null);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.configured).toBe(false);
    // A signer address we cannot settle from would be a lie with a checksum.
    expect(body.signers).toEqual({});
  });

  it("advertises the kind it can serve, in the protocol's shape", async () => {
    const response = await call({ verify: async () => ({}), settle: async () => ({}) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      configured: boolean;
      kinds: Array<{ x402Version: number; scheme: string; network: string; extra?: Record<string, unknown> }>;
      extensions: string[];
      signers: Record<string, string[]>;
    };
    expect(body.configured).toBe(true);
    expect(body.kinds).toHaveLength(1);
    expect(body.kinds[0]).toMatchObject({ x402Version: 2, scheme: "exact", network: "eip155:8453" });
    expect(body.kinds[0].extra?.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(body.extensions).toEqual([]);
    expect(body.signers["eip155:8453"]).toEqual(["0x680228D4915ad9f46C1f72e1D80370b56a42405"]);
  });

  it("is never cached: the configured state changes when an operator flips a variable", async () => {
    const response = await call(null);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
