import { describe, it, expect, vi } from "vitest";
import { payerFromPaymentHeader } from "../src/paid-quota.js";
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
  // These cases assert the paid gate. The free tier is on by default in production, so
  // disable it here rather than having every gate test silently exercise the free path.
  FREE_TIER_ENABLED: "false",
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

    /**
     * Our own challenge must stay small (#494). Seven of the 96 resources we probed send headers over 8,192 bytes — one at 10,164 —
     * and many gateways and proxies cap **total** headers at 8 KB, so a client behind one fails on those hosts with no useful error.
     * The fix on our side is not to be one of them: a 2 KB ceiling leaves room for the ordinary headers a request already carries.
     */
    expect(hdr as string).toBeTruthy();
    const headerBytes = Buffer.byteLength(hdr as string, "utf8");
    expect(headerBytes).toBeLessThan(2048);

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

/**
 * The payer on a refusal (#489). A `do_not_pay` never settles, so nothing can be read from a receipt — but the caller's payment
 * signature is already in the request, and its `authorization.from` is readable before verification. That is the wallet claiming to
 * pay, and recording it is the difference between "836 refusals, none attributable" and a list a manager can act on.
 *
 * The assertion uses the same header extraction the quota uses, so the two cannot drift: `payerFromPaymentHeader` is the single
 * reader, and it returns null rather than guessing when the header is absent or malformed.
 */
describe("refusal payer", () => {
  it("reads the claimed payer out of an unverified payment signature", () => {
    const header = Buffer.from(
      JSON.stringify({ payload: { authorization: { from: "0xAbC0000000000000000000000000000000000001" } } }),
    ).toString("base64");
    expect(payerFromPaymentHeader(header)).toBe("0xabc0000000000000000000000000000000000001");
    expect(payerFromPaymentHeader(null)).toBeNull();
    expect(payerFromPaymentHeader("not-base64-json")).toBeNull();
  });
});
