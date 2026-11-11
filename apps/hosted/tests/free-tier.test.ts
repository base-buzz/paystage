import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { resetFreeTierBuckets } from "../src/free-tier.js";

const FAKE_PAYTO = "0x000000000000000000000000000000000000dEaD";

const env = {
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
    list: vi.fn().mockResolvedValue({ items: [] }),
  };
}

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// A real PaymentRequired, so the free tier is proven to reach a real verdict rather than
// stopping at the request validator.
const validBody = {
  payment_required: {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "2000", // 0.002 USDC
        payTo: "0x000000000000000000000000000000000000dEaD",
        maxTimeoutSeconds: 60,
        asset: USDC,
      },
    ],
  },
  policy: {
    version: 1,
    max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: ["0x000000000000000000000000000000000000dEaD"],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:84532" }],
    allowed_networks: ["eip155:84532"],
    max_timeout_seconds: 300,
    unknown_payee: "review",
  },
};

function post(app: ReturnType<typeof createApp>, ip = "203.0.113.7", extraHeaders: Record<string, string> = {}) {
  return app.request(
    "/v1/evaluate_mcp_payment",
    {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...extraHeaders },
      body: JSON.stringify(validBody),
    },
    env as never,
  );
}

describe("free tier", () => {
  beforeEach(() => resetFreeTierBuckets());

  it("serves an unpaid request and says so in the headers", async () => {
    const app = createApp(env as never, { facilitatorClient: mockFacilitatorClient() as never });
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-paystage-free-tier")).toBe("free");
    expect(Number(res.headers.get("x-paystage-free-remaining"))).toBe(999);
  });

  it("counts down per IP, and does not charge another IP's allowance", async () => {
    const app = createApp(env as never, { facilitatorClient: mockFacilitatorClient() as never });
    await post(app, "203.0.113.7");
    const second = await post(app, "203.0.113.7");
    const other = await post(app, "198.51.100.9");
    expect(Number(second.headers.get("x-paystage-free-remaining"))).toBe(998);
    expect(Number(other.headers.get("x-paystage-free-remaining"))).toBe(999);
  });

  it("falls through to the paid challenge once the allowance is spent", async () => {
    const app = createApp(
      { ...env, FREE_TIER_DAILY_LIMIT: "1" } as never,
      { facilitatorClient: mockFacilitatorClient() as never },
    );
    const first = await post(app);
    const second = await post(app);
    expect(first.status).toBe(200);
    expect(second.status).toBe(402);
    expect(second.headers.get("x-paystage-free-tier")).toBe("exhausted");
  });

  it("a request carrying a payment signature is never counted as free", async () => {
    const app = createApp(env as never, { facilitatorClient: mockFacilitatorClient() as never });
    const res = await post(app, "203.0.113.7", { "payment-signature": "fake" });
    expect(res.headers.get("x-paystage-free-tier")).toBeNull();
  });

  it("can be switched off entirely", async () => {
    const app = createApp(
      { ...env, FREE_TIER_ENABLED: "false" } as never,
      { facilitatorClient: mockFacilitatorClient() as never },
    );
    const res = await post(app);
    expect(res.headers.get("x-paystage-free-tier")).toBeNull();
  });
});
