import { describe, it, expect, vi } from "vitest";
import { guardFetch, decodePaymentRequiredHeader } from "../src/index.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const OTHER_PAY_TO = "0x2222222222222222222222222222222222222222";

const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

function challenge(amount: string, payTo = PAY_TO): Response {
  const body = {
    x402Version: 2,
    resource: { url: "https://api.example.com/paid" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount,
        asset: USDC,
        payTo,
        maxTimeoutSeconds: 300,
      },
    ],
  };
  return new Response("{}", {
    status: 402,
    headers: { "payment-required": btoa(JSON.stringify(body)) },
  });
}

const paidOk = () => new Response("paid", { status: 200 });

describe("guardFetch", () => {
  it("pays when the policy allows it, and stamps the verdict", async () => {
    const wrap = vi.fn(() => async () => paidOk());
    const guarded = guardFetch(async () => challenge("2000") as never, { policy, wrap: wrap as never });
    const res = await guarded("https://api.example.com/paid");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-paystage-verdict")).toBe("pay");
    expect(wrap).toHaveBeenCalledOnce();
  });

  it("refuses an unknown payee and never reaches the wallet", async () => {
    const wrap = vi.fn(() => async () => paidOk());
    const guarded = guardFetch(async () => challenge("2000", OTHER_PAY_TO) as never, {
      policy,
      wrap: wrap as never,
    });
    const res = await guarded("https://api.example.com/paid");
    expect(res.status).toBe(402); // the real challenge, not a manufactured error
    expect(res.headers.get("x-paystage-verdict")).toBe("do_not_pay");
    expect(wrap).not.toHaveBeenCalled();
  });

  it("refuses an amount over the cap", async () => {
    const wrap = vi.fn(() => async () => paidOk());
    const guarded = guardFetch(async () => challenge("99000000") as never, { policy, wrap: wrap as never });
    const res = await guarded("https://api.example.com/paid");
    expect(res.headers.get("x-paystage-verdict")).toBe("do_not_pay");
    expect(wrap).not.toHaveBeenCalled();
  });

  it("does not wrap a non-402 response at all", async () => {
    const wrap = vi.fn(() => async () => paidOk());
    const guarded = guardFetch(async () => new Response("free", { status: 200 }) as never, {
      policy,
      wrap: wrap as never,
    });
    const res = await guarded("https://api.example.com/free");
    expect(res.headers.get("x-paystage-verdict")).toBe("pay");
    expect(res.headers.get("x-paystage-reason-codes")).toBe("no_payment_required");
    expect(wrap).not.toHaveBeenCalled();
  });

  it("refuses rather than guessing when the challenge cannot be read", async () => {
    const wrap = vi.fn(() => async () => paidOk());
    const guarded = guardFetch(
      async () => new Response("nonsense", { status: 402, headers: { "payment-required": "!!!not-base64!!!" } }) as never,
      { policy, wrap: wrap as never },
    );
    const res = await guarded("https://api.example.com/paid");
    expect(res.headers.get("x-paystage-verdict")).toBe("review");
    expect(res.headers.get("x-paystage-reason-codes")).toBe("unreadable_challenge");
    expect(wrap).not.toHaveBeenCalled();
  });

  it("rejects an invalid policy at construction rather than at payment time", () => {
    expect(() => guardFetch(async () => new Response(), { policy: { nonsense: true } })).toThrow(/invalid policy/);
  });

  it("decodes the v2 header", () => {
    const decoded = decodePaymentRequiredHeader(btoa(JSON.stringify({ x402Version: 2 }))) as { x402Version: number };
    expect(decoded.x402Version).toBe(2);
  });
});
