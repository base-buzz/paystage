import { describe, it, expect } from "vitest";
import { paystageTools } from "../src/index.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0xc64a71e150cd21ebc4b12695850bed6b067743bc";

const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  allowed_pay_to: [PAY_TO],
  unknown_payee: "deny",
  max_timeout_seconds: 300,
};

const challenge = (amountAtomic: string, payTo = PAY_TO) => ({
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: amountAtomic,
      asset: USDC,
      payTo,
      maxTimeoutSeconds: 300,
    },
  ],
});

// The tools are AI SDK `tool()` objects; calling execute directly is what the model would trigger.
const run = async (t: unknown, args: unknown) => (t as { execute: (a: unknown) => Promise<unknown> }).execute(args);

describe("@paystage/ai-sdk tools", () => {
  it("exposes exactly two tools, both prefixed", () => {
    const tools = paystageTools({ policy });
    expect(Object.keys(tools).sort()).toEqual(["paystage_evaluate_payment", "paystage_should_pay"]);
  });

  it("approves a payment inside the policy", async () => {
    const tools = paystageTools({ policy });
    const out = (await run(tools.paystage_evaluate_payment, { payment_required: challenge("2000") })) as {
      decision: string;
    };
    expect(out.decision).toBe("pay");
  });

  it("refuses a payment over the cap, with a reason a model can quote", async () => {
    const tools = paystageTools({ policy });
    const out = (await run(tools.paystage_evaluate_payment, { payment_required: challenge("1000000") })) as {
      decision: string;
      reasons: string[];
    };
    expect(out.decision).toBe("do_not_pay");
    expect(out.reasons.join(" ")).toMatch(/exceeds max_amount/);
  });

  it("refuses an unknown payee when the policy says deny", async () => {
    const tools = paystageTools({ policy });
    const out = (await run(tools.paystage_should_pay, {
      payment_required: challenge("2000", "0x000000000000000000000000000000000000dEaD"),
    })) as { allowed: boolean };
    expect(out.allowed).toBe(false);
  });

  it("honours onReview: refuse for a review verdict", async () => {
    // No allowed_pay_to and unknown_payee: "review" — the default lets it through, refuse does not.
    const reviewPolicy = { ...policy, allowed_pay_to: [], unknown_payee: "review" };
    const lenient = paystageTools({ policy: reviewPolicy });
    const strict = paystageTools({ policy: reviewPolicy, onReview: "refuse" });
    const a = (await run(lenient.paystage_should_pay, { payment_required: challenge("2000") })) as { allowed: boolean };
    const b = (await run(strict.paystage_should_pay, { payment_required: challenge("2000") })) as { allowed: boolean };
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(false);
  });
});
