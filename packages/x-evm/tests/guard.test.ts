import { describe, it, expect } from "vitest";
import { guardScheme, PaymentRefusedError, createGuardedScheme } from "../src/index.js";

/**
 * The guard's whole job is to make signing unreachable on a denial. These tests count signatures:
 * a refusal that still leaves one payload created is the failure mode that matters.
 */

const policy = {
  version: 1,
  max_amount: { value: "5", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      network: "eip155:8453",
    },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
} as never;

const ok = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "2000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
  maxTimeoutSeconds: 300,
};

const overCap = { ...ok, amount: "9000000" };
const stranger = { ...ok, payTo: "0x6160000000000000000000000000000000003757" };

function fakeScheme() {
  const calls = { created: 0 };
  return {
    calls,
    async createPaymentPayload(_v: number, _r: unknown, _c?: unknown) {
      calls.created += 1;
      return { payload: "signed" };
    },
  };
}

describe("guardScheme", () => {
  it("lets an allowed payment through and signs once", async () => {
    const scheme = fakeScheme();
    guardScheme(scheme, { policy });
    const payload = await scheme.createPaymentPayload(2, ok);
    expect(payload).toEqual({ payload: "signed" });
    expect(scheme.calls.created).toBe(1);
  });

  it("refuses over the cap and never signs", async () => {
    const scheme = fakeScheme();
    guardScheme(scheme, { policy });
    await expect(scheme.createPaymentPayload(2, overCap)).rejects.toBeInstanceOf(PaymentRefusedError);
    expect(scheme.calls.created).toBe(0);
  });

  it("refuses an unknown payee and never signs", async () => {
    const scheme = fakeScheme();
    guardScheme(scheme, { policy });
    await expect(scheme.createPaymentPayload(2, stranger)).rejects.toBeInstanceOf(PaymentRefusedError);
    expect(scheme.calls.created).toBe(0);
  });

  it("reports the verdict even when it refuses", async () => {
    const scheme = fakeScheme();
    const seen: string[] = [];
    guardScheme(scheme, { policy, onVerdict: (v) => seen.push(v.decision) });
    await expect(scheme.createPaymentPayload(2, overCap)).rejects.toThrow();
    expect(seen).toEqual(["do_not_pay"]);
  });

  it("carries the reason text into the error, not just a code", async () => {
    const scheme = fakeScheme();
    guardScheme(scheme, { policy });
    // The reason names the offending address — that is what a human pastes into a policy fix.
    await expect(scheme.createPaymentPayload(2, stranger)).rejects.toThrow(/0x6160|allowed_pay_to/i);
  });

  it("returns the same object, so instanceof checks keep working", () => {
    class Scheme {
      async createPaymentPayload() {
        return {};
      }
    }
    const s = new Scheme();
    expect(guardScheme(s, { policy })).toBe(s);
    expect(s).toBeInstanceOf(Scheme);
  });

  it("createGuardedScheme constructs and guards in one step", async () => {
    class Scheme {
      created = 0;
      constructor(public signer: string) {}
      async createPaymentPayload(_v: number, _r: unknown) {
        this.created += 1;
        return {};
      }
    }
    const s = createGuardedScheme(Scheme, ["signer"] as never, { policy });
    expect(s.signer).toBe("signer");
    await expect(s.createPaymentPayload(2, overCap)).rejects.toThrow();
    expect(s.created).toBe(0);
  });
});
