import { describe, expect, it } from "vitest";
import { createApp, facilitatorMode } from "../src/app.js";
import { buildPaymentMiddleware } from "../src/x402.js";
import { createFacilitatorRoutes } from "../src/routes/facilitator.js";
import { createSelfFacilitator } from "../src/self-facilitator.js";
import type { PaymentRequirements } from "@x402/core/types";
import {
  NETWORK,
  PAY_TO,
  TX,
  USDC,
  makeSigner,
  requirements,
  signedPayload,
} from "./facilitator-fixtures.js";

function selfClient() {
  const { signer, calls } = makeSigner();
  const client = createSelfFacilitator({
    signer,
    policy: { payTo: PAY_TO, network: NETWORK, asset: USDC, minimumAmount: "2000" },
  });
  return { client, calls };
}

async function post(
  app: { request: (...args: any[]) => Response | Promise<Response> },
  path: string,
  body: unknown,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /verify", () => {
  it("returns validity, the payer and no error for a valid payment", async () => {
    const { client } = selfClient();
    const app = createFacilitatorRoutes({ client });
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    const res = await post(app, "/verify", {
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: req,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isValid).toBe(true);
    expect(body.payer).toBeTruthy();
  });

  it("returns 200 with a named reason for a rejected payment", async () => {
    const { client } = selfClient();
    const app = createFacilitatorRoutes({ client });
    const req = requirements();
    const payload = await signedPayload({ requirements: req, to: "0x1111111111111111111111111111111111111111" });
    const res = await post(app, "/verify", {
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: req,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe("wrong_payee");
  });

  it("rejects malformed requests with 400 and does not pretend to verify", async () => {
    const { client } = selfClient();
    const app = createFacilitatorRoutes({ client });
    const res = await post(app, "/verify", { x402Version: 1 });
    expect(res.status).toBe(400);
  });
});

describe("POST /settle", () => {
  it("returns the v2 settlement shape", async () => {
    const { client } = selfClient();
    const app = createFacilitatorRoutes({ client });
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    const res = await post(app, "/settle", {
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: req,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: true,
      transaction: TX,
      network: NETWORK,
    });
    expect(body.payer).toBeTruthy();
  });

  it("settles a repeated payment id once over HTTP and returns the first hash", async () => {
    const { client, calls } = selfClient();
    const app = createFacilitatorRoutes({ client });
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    payload.extensions = {
      "payment-identifier": { info: { required: false, id: "pay_http_0000000001" } },
    };
    const body = { x402Version: 2, paymentPayload: payload, paymentRequirements: req };

    const first = (await (await post(app, "/settle", body)).json()) as Record<string, unknown>;
    const second = (await (await post(app, "/settle", body)).json()) as Record<string, unknown>;

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.transaction).toBe(first.transaction);
    expect(calls.write).toBe(1);
  });

  it("returns success:false with a reason rather than throwing", async () => {
    const { signer } = makeSigner({ failWrite: true });
    const client = createSelfFacilitator({
      signer,
      policy: { payTo: PAY_TO, network: NETWORK, asset: USDC, minimumAmount: "2000" },
    });
    const app = createFacilitatorRoutes({ client });
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    const res = await post(app, "/settle", {
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: req,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.errorReason).toBe("settlement_failed");
  });
});

describe("v2 vocabulary", () => {
  it("never emits an X-PAYMENT-* header", async () => {
    const { client } = selfClient();
    const app = createFacilitatorRoutes({ client });
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    for (const path of ["/verify", "/settle"]) {
      const res = await post(app, path, {
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: req,
      });
      for (const [name] of res.headers) {
        expect(name.toLowerCase()).not.toMatch(/^x-payment/);
      }
    }
  });
});

describe("the paid route settles through the self facilitator", () => {
  it("verifies and settles a real 402 challenge through the in-process client", async () => {
    const { Hono } = await import("hono");
    const { client, calls } = selfClient();
    const app = new Hono();
    app.use(
      "*",
      buildPaymentMiddleware(
        { payTo: PAY_TO, price: "$0.002", network: NETWORK, facilitatorUrl: "unused" },
        client,
      ),
    );
    app.post("/v1/paid/evaluate_mcp_payment", (c) => c.json({ decision: "pay" }));

    // Ask for the challenge the middleware actually builds, then sign exactly that.
    const first = await app.request("/v1/paid/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(first.status).toBe(402);
    const header =
      first.headers.get("payment-required") ?? first.headers.get("PAYMENT-REQUIRED");
    expect(header).toBeTruthy();
    const required = JSON.parse(
      Buffer.from(header as string, "base64").toString("utf8"),
    ) as { accepts: Array<Record<string, unknown>> };
    const req = required.accepts[0] as unknown as PaymentRequirements;
    expect(req).toBeTruthy();

    const payload = await signedPayload({ requirements: req });
    const paid = await app.request("/v1/paid/evaluate_mcp_payment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
      body: "{}",
    });
    expect(paid.status).toBe(200);
    expect(calls.write).toBe(1);
  });
});

describe("FACILITATOR_MODE", () => {
  const baseEnv = {
    PAYSTAGE_PAYTO: PAY_TO,
    PAYSTAGE_PRICE: "$0.002",
    PAYSTAGE_NETWORK: NETWORK,
    FREE_TIER_ENABLED: "false",
  };

  function env(extra: Record<string, string> = {}) {
    return { ...baseEnv, ...extra };
  }

  it("defaults to cdp, so production does not change until the flag is flipped", async () => {
    expect(facilitatorMode(env())).toBe("cdp");
    const app = createApp(env({ CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" }), {
      protect: false,
    });
    const res = await post(app, "/verify", { x402Version: 2 });
    expect(res.status).toBe(503);
  });

  it("builds a self facilitator in self mode even when CDP credentials are present", async () => {
    const { signer } = makeSigner();
    const e = env({
      FACILITATOR_MODE: "self",
      CDP_API_KEY_ID: "cdp-id",
      CDP_API_KEY_SECRET: "cdp-secret",
    });
    expect(facilitatorMode(e)).toBe("self");
    const app = createApp(e, { protect: false, facilitatorSigner: signer });
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    const res = await post(app, "/verify", {
      x402Version: 2,
      paymentPayload: payload,
      paymentRequirements: req,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).isValid).toBe(true);
  });

  it("fails closed in self mode without a gas key instead of falling back to CDP", async () => {
    const app = createApp(
      env({ FACILITATOR_MODE: "self", CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" }),
      { protect: false },
    );
    const res = await post(app, "/verify", { x402Version: 2 });
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).error).toBe(
      "facilitator_not_configured",
    );
  });
});

describe("no secret material in responses", () => {
  const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const CDP_SECRET = "cdp-secret-never-echo-this";

  it("returns no private key, CDP secret or gas-key name from /verify and /settle", async () => {
    const { signer } = makeSigner();
    const app = createApp(
      {
        PAYSTAGE_PAYTO: PAY_TO,
        PAYSTAGE_PRICE: "$0.002",
        PAYSTAGE_NETWORK: NETWORK,
        FREE_TIER_ENABLED: "false",
        FACILITATOR_MODE: "self",
        FACILITATOR_GAS_PRIVATE_KEY: TEST_KEY,
        CDP_API_KEY_ID: "cdp-id",
        CDP_API_KEY_SECRET: CDP_SECRET,
      },
      { protect: false, facilitatorSigner: signer },
    );
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    payload.extensions = {
      "payment-identifier": { info: { required: false, id: "pay_secret_0000000001" } },
    };
    const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req });

    for (const path of ["/verify", "/settle"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const text = await res.clone().text();
      expect(text).not.toContain(TEST_KEY);
      expect(text).not.toContain(TEST_KEY.slice(2));
      expect(text).not.toContain(CDP_SECRET);
      expect(text).not.toContain("FACILITATOR_GAS_PRIVATE_KEY");
      for (const [name, value] of res.headers) {
        expect(name.toLowerCase()).not.toMatch(/^x-payment/);
        expect(value).not.toContain(TEST_KEY);
      }
    }
  });
});
