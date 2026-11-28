import { describe, it, expect, vi } from "vitest";
import { payerFromPaymentHeader } from "../src/paid-quota.js";
import { createApp } from "../src/app.js";
import { VERIFIER_STATEMENT } from "../src/x402.js";

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

  it("states who verifies, by what key, under what terms, and where to re-check (#484)", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });

    // Every paid route, because a statement on one of three is not "every challenge".
    for (const path of [
      "/v1/paid/evaluate_mcp_payment",
      "/v1/evaluate_mcp_payment",
      "/v1/evaluate_outstanding_auths",
    ]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status, path).toBe(402);

      const hdr = res.headers.get("payment-required");
      expect(hdr, path).toBeTruthy();
      const decoded = JSON.parse(
        Buffer.from(hdr as string, "base64").toString("utf8"),
      ) as {
        accepts: Array<{ extra?: { verifier?: Record<string, string> } }>;
      };

      // Every accepts[] entry carries it, because it describes that entry's terms.
      for (const accept of decoded.accepts) {
        const verifier = accept.extra?.verifier;
        expect(verifier, path).toBeTruthy();
        expect(verifier?.who).toBe("PayStage");
        expect(verifier?.key).toBe("https://api.paystage.xyz/.well-known/paystage-receipt-key.json");
        expect(verifier?.terms).toBe("https://paystage.xyz/docs#verify");
        expect(verifier?.recheck).toBe("https://api.paystage.xyz/runs/{id}?format=receipt");
        // The limit is inside the challenge, not only on a web page.
        expect(verifier?.covers).toContain("authority");
        expect(verifier?.covers).toContain("not delivery or quality");
        expect(verifier).toEqual(VERIFIER_STATEMENT);
      }
    }
  });

  it("keeps every challenge under 2,048 bytes after adding the verifier (#484/#494)", async () => {
    const app = createApp(baseEnv, {
      facilitatorClient: mockFacilitatorClient(),
    });
    // All three routes, because the paid alias and the auths route carry longer resource
    // descriptions than the main one and were the first to cross the line (#484).
    for (const path of [
      "/v1/paid/evaluate_mcp_payment",
      "/v1/evaluate_mcp_payment",
      "/v1/evaluate_outstanding_auths",
    ]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const hdr = res.headers.get("payment-required") as string;
      const bytes = Buffer.byteLength(hdr, "utf8");
      // Before #484 the main route was 1,740 bytes in this harness (1,752 live); the other
      // two were larger. The live deployment adds 14 bytes for the api.paystage.xyz
      // resource URL, so keep real headroom rather than fitting the test environment.
      expect(bytes, path).toBeLessThan(2048);
      expect(bytes, path).toBeGreaterThan(1900);
    }
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
 * The settlement response is the other half of the claim (#484). A verifier statement says
 * who will check; `PAYMENT-RESPONSE` is the record that lets anyone check afterwards. The
 * claim must be testable, so this drives a real paid request through the middleware and
 * reads the transaction hash and network out of the header the buyer receives.
 */
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TX_HASH = `0x${"ab".repeat(32)}`;
const PAYER = "0x00000000000000000000000000000000000000A1";

/** A body the evaluator accepts, so a paid request reaches the handler and settles. */
const EVALUATION_BODY = {
  payment_required: {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "2000",
        payTo: FAKE_PAYTO,
        maxTimeoutSeconds: 60,
        asset: USDC,
      },
    ],
  },
  policy: {
    version: 1,
    max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: [FAKE_PAYTO],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:84532" }],
    allowed_networks: ["eip155:84532"],
    max_timeout_seconds: 300,
    unknown_payee: "review",
  },
};

function paidFacilitatorClient() {
  return {
    getSupported: vi.fn().mockResolvedValue({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
    }),
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: PAYER }),
    settle: vi.fn().mockResolvedValue({
      success: true,
      transaction: TX_HASH,
      network: "eip155:84532",
      payer: PAYER,
    }),
  };
}

/** Build the `PAYMENT-SIGNATURE` value a client would send, accepted terms copied verbatim. */
async function signedPaymentHeader(app: ReturnType<typeof createApp>): Promise<string> {
  const challenge = await app.request("/v1/evaluate_mcp_payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(EVALUATION_BODY),
  });
  const decoded = JSON.parse(
    Buffer.from(challenge.headers.get("payment-required") as string, "base64").toString("utf8"),
  ) as { accepts: unknown[] };
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: decoded.accepts[0],
      payload: { authorization: { from: PAYER }, signature: `0x${"11".repeat(65)}` },
    }),
  ).toString("base64");
}

describe("settlement response", () => {
  it("carries the transaction hash and network, in v2 vocabulary", async () => {
    const app = createApp(baseEnv, { facilitatorClient: paidFacilitatorClient() });
    const header = await signedPaymentHeader(app);
    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json", "payment-signature": header },
      body: JSON.stringify(EVALUATION_BODY),
    });
    expect(res.status).toBe(200);

    const raw = res.headers.get("payment-response");
    expect(raw).toBeTruthy();
    const settled = JSON.parse(Buffer.from(raw as string, "base64").toString("utf8")) as {
      success?: boolean;
      transaction?: string;
      network?: string;
      payer?: string;
    };
    expect(settled.success).toBe(true);
    expect(settled.transaction).toBe(TX_HASH);
    expect(settled.network).toBe("eip155:84532");
    expect(settled.payer?.toLowerCase()).toBe(PAYER.toLowerCase());

    // The launch-era spelling is accepted on input but never emitted.
    expect(res.headers.get("x-payment-response")).toBeNull();
  });

  it("accepts the launch-era X-PAYMENT spelling and logs which header was seen (#484)", async () => {
    const app = createApp(baseEnv, { facilitatorClient: paidFacilitatorClient() });
    const header = await signedPaymentHeader(app);
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    try {
      const res = await app.request("/v1/evaluate_mcp_payment", {
        method: "POST",
        headers: { "content-type": "application/json", "x-payment": header },
        body: JSON.stringify(EVALUATION_BODY),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("payment-response")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
    expect(logged.some((line) => line.includes("legacy_payment_header_seen") && line.includes("x-payment"))).toBe(true);
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
