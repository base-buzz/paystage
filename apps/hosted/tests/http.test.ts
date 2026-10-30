import { describe, it, expect, vi } from "vitest";
import { createApp } from "../src/app.js";

// Fake payTo for unit tests — never a real treasury address.
const FAKE_PAYTO = "0x000000000000000000000000000000000000dEaD";

// Base env for unit tests: Sepolia network + x402.org facilitator.
// No CDP credentials — tests must not require mainnet secrets.
const baseEnv = {
  PAYSTAGE_PAYTO: FAKE_PAYTO,
  PAYSTAGE_PRICE: "$0.002",
  PAYSTAGE_NETWORK: "eip155:84532",
  FACILITATOR_URL: "https://x402.org/facilitator",
};

function mockFacilitatorClient() {
  return {
    getSupported: vi.fn().mockResolvedValue({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: "eip155:84532",
        },
      ],
    }),
    verify: vi.fn(),
    settle: vi.fn(),
  };
}

describe("hosted app", () => {
  it("returns health", async () => {
    const app = createApp(baseEnv, { protect: false });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("returns 402 without payment on protected route", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
  });

  it("returns 402 without payment on outstanding auths route", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/v1/evaluate_outstanding_auths", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
  });

  it("402 body advertises the configured network and price", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);

    // x402 v2 puts payment requirements in the `payment-required` header
    // as base64-encoded JSON, not in the response body.
    const hdr =
      res.headers.get("payment-required") ??
      res.headers.get("PAYMENT-REQUIRED");
    expect(hdr).toBeTruthy();

    const decoded = JSON.parse(
      Buffer.from(hdr as string, "base64").toString("utf8"),
    ) as {
      accepts?: Array<{
        network?: string;
        payTo?: string;
        amount?: string;
        price?: string;
      }>;
    };

    const accepts = decoded.accepts ?? [];
    expect(accepts.length).toBeGreaterThan(0);
    expect(accepts[0]?.network).toBe("eip155:84532");
    expect(accepts[0]?.payTo?.toLowerCase()).toBe(FAKE_PAYTO.toLowerCase());

    // Price may be advertised as an atomic amount ("2000") or as the
    // human-readable price string ("$0.002").
    const amount = accepts[0]?.amount;
    const price = accepts[0]?.price;
    expect(amount === "2000" || price === "$0.002").toBe(true);
  });

  it("does not protect health route", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
