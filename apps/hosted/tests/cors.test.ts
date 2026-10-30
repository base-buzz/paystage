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

describe("CORS — /v1/evaluate_mcp_payment", () => {
  it("OPTIONS preflight from paystage.xyz returns allow-origin + expose payment-required", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-payment",
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    const expose = (res.headers.get("access-control-expose-headers") || "").toLowerCase();
    expect(expose).toContain("payment-required");
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

  it("POST without payment returns 402 and includes allow-origin for paystage.xyz", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    const expose = (res.headers.get("access-control-expose-headers") || "").toLowerCase();
    expect(expose).toContain("payment-required");
  });
});
