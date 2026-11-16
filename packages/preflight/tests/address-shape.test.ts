import { describe, it, expect } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const GOOD = "0xc64a71e150cd21ebc4b12695850bed6b067743bc";

const policy = (payees: string[]) => ({
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  allowed_pay_to: payees,
  max_timeout_seconds: 300,
  unknown_payee: "deny",
});

const challenge = (payee: string) => ({
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000", asset: USDC, payTo: payee, maxTimeoutSeconds: 300 }],
});

describe("payee address shape", () => {
  it("refuses a payee with 41 hex characters, even when the policy lists it", () => {
    // Found by an external agent testing us: the string matched the allow-list as text, so we answered `pay`.
    const bad = "0x6160a0d8a3a1f8b0c4e2d1f7b3a9c6e5d4f23757e";
    const r = evaluatePayment(challenge(bad) as never, policy([bad]) as never);
    expect(r.decision).toBe("do_not_pay");
    expect(r.reasons.join(" ")).toMatch(/invalid payTo address/);
  });

  it("names the reason so the caller can fix it, with the length it got", () => {
    const r = evaluatePayment(challenge("0xdeadbeef") as never, policy(["0xdeadbeef"]) as never);
    expect(r.reasons.join(" ")).toMatch(/got 8/);
  });

  it("still pays a well-formed allowed payee", () => {
    const r = evaluatePayment(challenge(GOOD) as never, policy([GOOD]) as never);
    expect(r.decision).toBe("pay");
  });
});
