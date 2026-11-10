import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const FAKE_PAYTO = "0x000000000000000000000000000000000000dEaD";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const env = {
  PAYSTAGE_PAYTO: FAKE_PAYTO,
  PAYSTAGE_PRICE: "$0.002",
  PAYSTAGE_NETWORK: "eip155:84532",
  FACILITATOR_URL: "https://x402.org/facilitator",
};

const policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [FAKE_PAYTO],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:84532" }],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 300,
  unknown_payee: "review",
  agents: { reader: { max_amount: { value: "0.05", asset: "USDC", decimals: 6 } } },
};

const paymentRequired = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "200000", // 0.20 USDC
      payTo: FAKE_PAYTO,
      maxTimeoutSeconds: 60,
      asset: USDC,
    },
  ],
};

/** The handler authorises before the body runs, so ask with a bypassed middleware. */
function app() {
  return createApp(env, { protect: false });
}

async function evaluate(body: Record<string, unknown>) {
  const res = await app().request("/v1/evaluate_mcp_payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment_required: paymentRequired, policy, ...body }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("agent_id through the hosted API", () => {
  it("denies when the policy declares agents and none is given", async () => {
    const { body } = await evaluate({});
    expect(body.decision).toBe("do_not_pay");
    expect(JSON.stringify(body.reasons)).toMatch(/agent_id/);
  });

  it("denies an unknown agent", async () => {
    const { body } = await evaluate({ agent_id: "ghost" });
    expect(body.decision).toBe("do_not_pay");
    expect(JSON.stringify(body.reasons)).toMatch(/unknown agent/);
  });

  it("applies the agent's narrower ceiling instead of the global one", async () => {
    const { body } = await evaluate({ agent_id: "reader" });
    expect(body.decision).toBe("do_not_pay");
    expect(JSON.stringify(body.reasons)).toMatch(/max_amount/);
  });

  it("rejects a non-string agent_id", async () => {
    const { status, body } = await evaluate({ agent_id: 42 });
    expect(status).toBe(400);
    expect(body.error).toBe("agent_id_must_be_a_string");
  });

  it("binds the agent decision into the receipt", async () => {
    const { body } = await evaluate({ agent_id: "reader" });
    const receipt = body.receipt as { verdict: { decision: string } };
    expect(receipt.verdict.decision).toBe("do_not_pay");
  });
});
