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


  it("honours onReview: refuse, because the README promises it blocks", async () => {
    // Regression: normalizeVerdict returned "review" from both branches, so this option refused nothing while the README
    // and llms.txt said it did. The verdict stays `review`; the payment must not happen.
    const wrap = vi.fn(() => async () => paidOk());
    const guarded = guardFetch(
      async () => new Response("nonsense", { status: 402, headers: { "payment-required": "!!!not-base64!!!" } }) as never,
      { policy, wrap: wrap as never, onReview: "refuse" },
    );
    const res = await guarded("https://api.example.com/paid");
    expect(res.headers.get("x-paystage-verdict")).toBe("review");
    expect(wrap).not.toHaveBeenCalled();
  });

  it("honours onReview: pay, which treats a review as permission", async () => {
    // A genuine review: an unknown payee under a policy that says review rather than deny. An unreadable challenge is a
    // hard do_not_pay, which is a different path and would have made this test pass for the wrong reason.
    const reviewPolicy = { ...policy, allowed_pay_to: [OTHER_PAY_TO], unknown_payee: "review" };
    const wrap = vi.fn(() => async () => paidOk());
    const guarded = guardFetch(
      async () => challenge("10000", PAY_TO) as never,
      { policy: reviewPolicy, wrap: wrap as never, onReview: "pay" },
    );
    const res = await guarded("https://api.example.com/paid");
    // The verdict is still reported honestly as `review`; only the decision to pay changes.
    expect(res.headers.get("x-paystage-verdict")).toBe("review");
    expect(wrap).toHaveBeenCalled();
  });

  it("rejects an invalid policy at construction rather than at payment time", () => {
    expect(() => guardFetch(async () => new Response(), { policy: { nonsense: true } })).toThrow(/invalid policy/);
  });

  it("decodes the v2 header", () => {
    const decoded = decodePaymentRequiredHeader(btoa(JSON.stringify({ x402Version: 2 }))) as { x402Version: number };
    expect(decoded.x402Version).toBe(2);
  });
});
