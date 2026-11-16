import { beforeEach, describe, it, expect } from "vitest";
import { Hono } from "hono";
import { paidQuotaMiddleware, payerFromPaymentHeader, resetPaidQuota } from "../src/paid-quota.js";

const PAYER = "0xc64a71e150cd21ebc4b12695850bed6b067743bc";

/** An x402 payment signature as the header carries it: base64 JSON with the authorisation inside. */
const signature = (from: string) =>
  Buffer.from(
    JSON.stringify({ x402Version: 2, scheme: "exact", network: "eip155:8453", payload: { authorization: { from } } }),
  ).toString("base64");

function app(limit: number) {
  const a = new Hono();
  a.use("*", paidQuotaMiddleware({ dailyLimit: limit }));
  a.post("/paid", (c) => c.json({ ok: true }));
  return a;
}

describe("paid-path quota", () => {
  beforeEach(() => resetPaidQuota());

  it("reads the payer out of the payment header", () => {
    expect(payerFromPaymentHeader(signature(PAYER))).toBe(PAYER);
  });

  it("does not invent a payer from a malformed or absent header", () => {
    expect(payerFromPaymentHeader(null)).toBeNull();
    expect(payerFromPaymentHeader("not-base64")).toBeNull();
    expect(payerFromPaymentHeader(Buffer.from("{}").toString("base64"))).toBeNull();
  });

  it("answers 429 with a retry hint once the payer is over the cap", async () => {
    const a = app(2);
    const header = { "payment-signature": signature(PAYER) };
    expect((await a.request("/paid", { method: "POST", headers: header })).status).toBe(200);
    expect((await a.request("/paid", { method: "POST", headers: header })).status).toBe(200);
    const third = await a.request("/paid", { method: "POST", headers: header });
    expect(third.status).toBe(429);
    const body = (await third.json()) as { error: string; limit: number; retry_after_seconds: number };
    expect(body.error).toBe("paid_quota_exceeded");
    expect(body.limit).toBe(2);
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });

  it("counts each payer separately", async () => {
    const a = app(1);
    const other = "0x1111111111111111111111111111111111111111";
    expect((await a.request("/paid", { method: "POST", headers: { "payment-signature": signature(PAYER) } })).status).toBe(200);
    // A different wallet has its own allowance; a limit that pooled them would block an innocent caller.
    expect((await a.request("/paid", { method: "POST", headers: { "payment-signature": signature(other) } })).status).toBe(200);
    expect((await a.request("/paid", { method: "POST", headers: { "payment-signature": signature(PAYER) } })).status).toBe(429);
  });

  it("leaves an unpaid request to the free tier", async () => {
    const a = app(1);
    // No payment header: not this middleware's business, however many times it is called.
    for (let i = 0; i < 5; i++) expect((await a.request("/paid", { method: "POST" })).status).toBe(200);
  });
});
