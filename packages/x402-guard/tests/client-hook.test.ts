import { describe, it, expect } from "vitest";
import { paystageClientHook, evaluateBeforeCreation } from "../src/client-hook.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0xc64a71e150cd21ebc4b12695850bed6b067743bc";

const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  allowed_pay_to: [PAY_TO],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

const ctx = (amount: string, payTo = PAY_TO) => ({
  paymentRequired: { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount, asset: USDC, payTo, maxTimeoutSeconds: 300 }] },
  selectedRequirements: { scheme: "exact", network: "eip155:8453", amount, asset: USDC, payTo, maxTimeoutSeconds: 300 },
});

/**
 * A stand-in for the part of `x402Client` the hook touches. The real wiring is
 * `client.onBeforePaymentCreation(paystageClientHook({ policy }))`; this fake reproduces the contract that
 * matters — a hook returning `{abort}` stops payload creation before any signature exists.
 */
function fakeClient() {
  const hooks: Array<(c: unknown) => Promise<unknown>> = [];
  return {
    onBeforePaymentCreation(hook: (c: unknown) => Promise<unknown>) {
      hooks.push(hook);
      return this;
    },
    async createPayload(context: unknown) {
      for (const hook of hooks) {
        const outcome = (await hook(context)) as { abort?: boolean; reason?: string } | undefined;
        if (outcome?.abort) return { aborted: true, reason: outcome.reason };
      }
      return { aborted: false, reason: null };
    },
  };
}

describe("@x402/core client hook adapter", () => {
  it("runs the gate before a payload is created and aborts an over-cap payment", async () => {
    const client = fakeClient().onBeforePaymentCreation(paystageClientHook({ policy }));
    const result = await client.createPayload(ctx("1000000")); // 1.00 against a 0.05 cap
    expect(result.aborted).toBe(true);
    expect(result.reason).toMatch(/exceeds max_amount/);
  });

  it("lets an in-policy payment through untouched", async () => {
    const client = fakeClient().onBeforePaymentCreation(paystageClientHook({ policy }));
    expect(await client.createPayload(ctx("2000"))).toEqual({ aborted: false, reason: null });
  });

  it("refuses an unknown payee, with the rule named", async () => {
    // A fresh address, not the burn address: 0x…dEaD is itself on the drainer list, so it would refuse for
    // a different (also correct) reason and the test would pass while testing the wrong rule.
    const unknown = "0x1111111111111111111111111111111111111111";
    const out = await evaluateBeforeCreation(ctx("2000", unknown), { policy });
    expect(out).toMatchObject({ abort: true });
    if (out && "reason" in out) expect(out.reason).toMatch(/not in allowed_pay_to/);
  });

  it("refuses a known drainer even when the allow-list contains it", async () => {
    // A cited entry from the curated list (0xCERT-2026-0230). The burn address used to be here and is now
    // its own reason — see the next test, because "the right answer for the wrong reason" is a bug too.
    const drainer = "0x0b5126e1bc27c0de77e02e97945760a674edb034";
    const permissive = { ...policy, allowed_pay_to: [drainer], unknown_payee: "review" };
    const out = await evaluateBeforeCreation(ctx("2000", drainer), { policy: permissive });
    expect(out).toMatchObject({ abort: true });
    if (out && "reason" in out) expect(out.reason).toBe("known drainer");
  });

  it("refuses a non-receivable sink and says so, rather than calling it a drainer", async () => {
    const sink = "0x000000000000000000000000000000000000dEaD";
    const permissive = { ...policy, allowed_pay_to: [sink], unknown_payee: "review" };
    const out = await evaluateBeforeCreation(ctx("2000", sink), { policy: permissive });
    expect(out).toMatchObject({ abort: true });
    if (out && "reason" in out) {
      expect(out.reason).toMatch(/non-receivable/i);
      expect(out.reason).not.toMatch(/known drainer/i);
    }
  });

  it("fails closed when the policy cannot be evaluated", async () => {
    const out = await evaluateBeforeCreation(ctx("2000"), { policy: null });
    expect(out).toMatchObject({ abort: true });
    if (out && "reason" in out) expect(out.reason).toContain("evaluation_failed");
  });

  it("refuses a payment it cannot price rather than assuming it is small", async () => {
    const out = await evaluateBeforeCreation(ctx("12.50"), { policy });
    expect(out).toMatchObject({ abort: true, reason: "paystage_unreadable_amount" });
  });

  it("reports the verdict to onVerdict, like guardFetch does", async () => {
    const seen: string[] = [];
    await evaluateBeforeCreation(ctx("1000000"), { policy, onVerdict: (v) => seen.push(v.verdict) });
    expect(seen).toEqual(["do_not_pay"]);
  });
});
