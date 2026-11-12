import { describe, expect, it } from "vitest";
import { parsePolicy } from "@paystage/policy";
import { evaluatePayment } from "../src/evaluate.js";

/**
 * The amount ceiling is the whole product: if an amount over `max_amount` is judged `pay`,
 * a wallet drains while the receipt reports that everything was fine. Reading the comparison
 * cannot establish that it is right; comparing it against an independent reference can.
 *
 * What this file pins, and why each part exists:
 *
 *  1. **Agreement** — 800 seeded cases, `evaluatePayment` against an exact decimal reference.
 *     The reference is BigInt on both sides. Not floats: `parseFloat("0.05") * 1e6` lands on
 *     either side of 50000 depending on the value, and a test that compares one rounding error
 *     with another reports agreement that means nothing.
 *  2. **The boundary** — exactly `max_amount` pays, one atomic unit over does not. Inclusive by
 *     decision; the off-by-one at that edge is the kind of thing a user finds at the worst moment.
 *  3. **The closed drain** — a policy whose `max_amount.decimals` disagree with the asset it caps
 *     is refused at construction. It used to be accepted, and a 0.05 cap became 50,000,000,000.
 *
 * Seeded PRNG on purpose: a failure must be reproducible from the seed alone, in any container,
 * by anyone. `Math.random()` here would make a red build unactionable.
 */

const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DAI = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
const PAYEE = "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE";
const NET = "eip155:8453";

/** Deterministic PRNG (mulberry32). Any seed-compatible implementation gives the same run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A human decimal string as an integer in `decimals` units. Exact: no floats, no rounding. */
function humanToAtomicExact(value: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) throw new Error(`not a decimal string: ${value}`);
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction === "" ? "0" : fraction);
}

function policyFor(value: string, decimals: number) {
  return {
    version: 1 as const,
    max_amount: { value, asset: "USDC", decimals },
    allowed_pay_to: [PAYEE],
    allowed_assets: [{ symbol: "USDC", decimals, address: ASSET, network: NET }],
    allowed_networks: [NET],
    max_timeout_seconds: 300,
    unknown_payee: "deny" as const,
  };
}

function requestFor(amountAtomic: bigint, asset: string = ASSET) {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: NET,
        asset,
        payTo: PAYEE,
        maxTimeoutSeconds: 300,
        amount: amountAtomic.toString(),
      },
    ],
  };
}

describe("amount ceiling — differential against an exact reference", () => {
  it("agrees with the reference on 800 seeded cases", () => {
    const rnd = mulberry32(20261112);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const disagreements: string[] = [];
    let checked = 0;
    let refusedAtConstruction = 0;

    for (let i = 0; i < 800; i += 1) {
      const decimals = pick([0, 6, 8, 18]);
      const value = pick(["0.05", "1", "0.5", "100", "0.0001"]);
      const amountAtomic = BigInt(Math.floor(rnd() * 1e6)) * 10n ** BigInt(pick([0, 3, 6, 12]));

      // A value with more decimal places than `decimals` is now refused at construction
      // (see schema-crossfield.test.ts). Those pairs are not a differential case — the
      // policy never exists — so they are counted separately rather than skipped silently.
      let policy;
      try {
        policy = parsePolicy(policyFor(value, decimals));
      } catch {
        refusedAtConstruction += 1;
        continue;
      }

      const decided = evaluatePayment(requestFor(amountAtomic), policy).decision;
      const shouldPay = amountAtomic <= humanToAtomicExact(value, decimals);

      checked += 1;
      if (shouldPay !== (decided === "pay")) {
        disagreements.push(
          `${value}@${decimals}dp amount=${amountAtomic.toString()} → ${decided}, reference says ${shouldPay ? "pay" : "do_not_pay"}`,
        );
      }
    }

    expect(checked + refusedAtConstruction).toBe(800);
    expect(checked).toBeGreaterThan(500);
    expect(disagreements).toEqual([]);
  });

  it("is inclusive at the boundary: exactly max_amount pays, one atomic unit over does not", () => {
    const policy = parsePolicy(policyFor("0.05", 6));
    expect(evaluatePayment(requestFor(50_000n), policy).decision).toBe("pay");
    expect(evaluatePayment(requestFor(50_001n), policy).decision).toBe("do_not_pay");
  });

  it("refuses the 10^12 policy at construction instead of paying 40,000 USDC", () => {
    // Before this was enforced, this exact policy judged a 40,000 USDC challenge `pay`:
    // the cap said 0.05 USDC, but 18 decimals against a 6-decimal asset scaled it by 10^12.
    // Note the two different decimals — the cap's and the asset's. That disagreement is the bug.
    const mismatched = {
      ...policyFor("0.05", 6),
      max_amount: { value: "0.05", asset: "USDC", decimals: 18 },
    };
    expect(() => parsePolicy(mismatched)).toThrow(/decimal/i);
  });

  it("still refuses an uncapped asset unless the policy opts in explicitly", () => {
    const bothAssets = [
      { symbol: "USDC", decimals: 6, address: ASSET, network: NET },
      { symbol: "DAI", decimals: 18, address: DAI, network: NET },
    ];
    expect(() => parsePolicy({ ...policyFor("0.05", 6), allowed_assets: bothAssets })).toThrow(
      /uncapped|no cap/i,
    );

    // Opted in, an uncovered asset is judged by the other rules and not by the USDC cap —
    // documented behaviour, which is why it is asserted rather than assumed.
    const optedIn = parsePolicy({
      ...policyFor("0.05", 6),
      allowed_assets: bothAssets,
      allow_uncapped_assets: true,
    });
    expect(evaluatePayment(requestFor(999n * 10n ** 18n, DAI), optedIn).decision).toBe("pay");
  });
});
