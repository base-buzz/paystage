import { describe, it, expect } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";
import { parsePolicy } from "@paystage/policy";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYEE = "0xc64a71e150cd21ebc4b12695850bed6b067743bc";

const policy = (time_window: unknown) =>
  ({
    version: 1,
    max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
    allowed_networks: ["eip155:8453"],
    allowed_pay_to: [PAYEE],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
    time_window,
  }) as never;

const challenge = {
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000", asset: USDC, payTo: PAYEE, maxTimeoutSeconds: 300 }],
} as never;

const at = (iso: string) => ({ now: new Date(iso) });

describe("time windows", () => {
  it("allows inside a simple window and refuses outside it", () => {
    const p = policy({ allowed_hours_utc: [9, 17] });
    expect(evaluatePayment(challenge, p, at("2026-11-16T10:00:00Z")).decision).toBe("pay");
    const out = evaluatePayment(challenge, p, at("2026-11-16T03:00:00Z"));
    expect(out.decision).toBe("do_not_pay");
    expect(out.reasons.join(" ")).toMatch(/outside allowed hours: policy permits 09:00–17:00 UTC, now 03:00 UTC/);
  });

  it("handles a window that crosses midnight", () => {
    const p = policy({ allowed_hours_utc: [22, 6] }); // 22:00–05:59
    expect(evaluatePayment(challenge, p, at("2026-11-16T23:30:00Z")).decision).toBe("pay");
    expect(evaluatePayment(challenge, p, at("2026-11-16T05:59:00Z")).decision).toBe("pay");
    expect(evaluatePayment(challenge, p, at("2026-11-16T06:00:00Z")).decision).toBe("do_not_pay");
    expect(evaluatePayment(challenge, p, at("2026-11-16T21:59:00Z")).decision).toBe("do_not_pay");
  });

  it("treats the boundary as half-open, so end hour is already outside", () => {
    const p = policy({ allowed_hours_utc: [9, 17] });
    expect(evaluatePayment(challenge, p, at("2026-11-16T16:59:00Z")).decision).toBe("pay");
    expect(evaluatePayment(challenge, p, at("2026-11-16T17:00:00Z")).decision).toBe("do_not_pay");
  });

  it("blocks a listed hour regardless of the allow-list", () => {
    const p = policy({ blocked_hours_utc: [0, 6] });
    expect(evaluatePayment(challenge, p, at("2026-11-16T02:00:00Z")).decision).toBe("do_not_pay");
    expect(evaluatePayment(challenge, p, at("2026-11-16T08:00:00Z")).decision).toBe("pay");
  });

  it("rejects a policy that sets both kinds of window", () => {
    // The schema allows exactly one; two would mean "allowed and blocked" with no precedence, which is a
    // question the policy should not be able to leave open.
    expect(() => parsePolicy(policy({ allowed_hours_utc: [9, 17], blocked_hours_utc: [12, 13] }))).toThrow();
  });
});
