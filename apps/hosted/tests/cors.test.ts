// CORS tests for /v1/evaluate_mcp_payment. Additive to http.test.ts.

import { describe, it, expect, vi } from "vitest";
import { createApp } from "../src/app.js";

const FAKE_PAYTO = "0x000000000000000000000000000000000000dEaD";

const baseEnv = {
  PAYSTAGE_PAYTO: FAKE_PAYTO,
  PAYSTAGE_PRICE: "$0.002",
  PAYSTAGE_NETWORK: "eip155:84532",
  FACILITATOR_URL: "https://x402.org/facilitator",
};

function mockFacilitatorClient() {
  return {
    getSupported: vi.fn().mockResolvedValue({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
    }),
    verify: vi.fn(),
    settle: vi.fn(),
  };
}

const ALLOWED_ORIGIN = "https://paystage.xyz";
const DISALLOWED_ORIGIN = "https://evil.example";

const RETRY_REQUEST_HEADERS =
  "content-type,payment-signature,access-control-expose-headers,x-paystage-request-id,accept,x-payment";

describe("CORS — /v1/evaluate_mcp_payment", () => {
  it("OPTIONS preflight allows x402 retry headers + request id", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": RETRY_REQUEST_HEADERS,
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    const allow = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
    for (const h of [
      "content-type",
      "payment-signature",
      "access-control-expose-headers",
      "x-paystage-request-id",
      "x-payment",
    ]) {
      expect(allow).toContain(h);
    }
    const expose = (res.headers.get("access-control-expose-headers") || "").toLowerCase();
    expect(expose).toContain("payment-required");
    expect(expose).toContain("x-paystage-request-id");
  });

  it("OPTIONS preflight from disallowed origin omits allow-origin", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "OPTIONS",
      headers: {
        Origin: DISALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("POST without payment returns 402 with CORS + echoes request id", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const rid = "test-rid-123";
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        "x-paystage-request-id": rid,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("x-paystage-request-id")).toBe(rid);
  });
});
