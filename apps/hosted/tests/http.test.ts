import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

const baseEnv = {
  PAYSTAGE_PAYTO: "0x00000000000000000000000000000000000000AA",
  PAYSTAGE_PRICE: "$0.002",
  PAYSTAGE_NETWORK: "eip155:84532",
  FACILITATOR_URL: "https://x402.org/facilitator",
};

const policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      network: "eip155:84532",
    },
  ],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 300,
  unknown_payee: "review",
};

const paymentRequired = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "2000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 300,
    },
  ],
};

describe("hosted http", () => {
  it("GET /health returns 200", async () => {
    const app = createApp(baseEnv, { protect: false });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("POST unpaid evaluate_mcp_payment returns 402", async () => {
    const mockFacilitator = { getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }] }) };
    const app = createApp(baseEnv, { facilitatorClient: mockFacilitator as never });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_required: paymentRequired, policy }),
    });
    expect(res.status).toBe(402);
  });

  it("protect:false valid evaluate_mcp_payment returns decision pay", async () => {
    const app = createApp(baseEnv, { protect: false });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_required: paymentRequired, policy }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { decision?: string };
    expect(json.decision).toBe("pay");
  });

  it("protect:false missing payment_required returns 400", async () => {
    const app = createApp(baseEnv, { protect: false });
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    expect(res.status).toBe(400);
  });

  it("protect:false outstanding missing wallet returns 400", async () => {
    const app = createApp(baseEnv, { protect: false });
    const res = await app.request("/v1/evaluate_outstanding_auths", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    expect(res.status).toBe(400);
  });
});
