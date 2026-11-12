import { describe, it, expect } from "vitest";
import { parsePolicy } from "../src/index.js";

/**
 * Cross-field policy checks. Each of these was a live hole found by differential testing of
 * `evaluatePayment` against an exact BigInt reference:
 *
 *   - the arithmetic itself was correct across 800 generated cases (0 disagreements)
 *   - what surrounded it was not
 */

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DAI = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
const PAY_TO = "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE";

const base = {
  version: 1 as const,
  allowed_pay_to: [PAY_TO],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny" as const,
};

const usdcAsset = { symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" };
const daiAsset = { symbol: "DAI", decimals: 18, address: DAI, network: "eip155:8453" };

describe("decimals must describe the asset they cap", () => {
  it("refuses a cap whose decimals disagree with the named asset", () => {
    // The drain: the same "0.05" with 18 decimals against a 6-decimal asset is a cap
    // 10^12 times too large. A policy that looks correct judged 40,000 USDC as `pay`.
    expect(() =>
      parsePolicy({
        ...base,
        max_amount: { value: "0.05", asset: "USDC", decimals: 18 },
        allowed_assets: [usdcAsset],
      }),
    ).toThrow(/10\^12 times too large/);
  });

  it("refuses the reverse, which would silently shrink the cap", () => {
    expect(() =>
      parsePolicy({
        ...base,
        max_amount: { value: "0.05", asset: "DAI", decimals: 6 },
        allowed_assets: [daiAsset],
      }),
    ).toThrow(/too small/);
  });

  it("accepts a matching pair", () => {
    expect(() =>
      parsePolicy({
        ...base,
        max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
        allowed_assets: [usdcAsset],
      }),
    ).not.toThrow();
  });
});

describe("precision is checked at construction, not at payment time", () => {
  it("refuses a value with more places than decimals", () => {
    // Previously parsed fine and then threw inside evaluatePayment — a 400 on a live request,
    // contradicting the guard README's "throws at construction, not at payment time".
    expect(() =>
      parsePolicy({
        ...base,
        max_amount: { value: "0.05", asset: "USDC", decimals: 0 },
        allowed_assets: [usdcAsset],
      }),
    ).toThrow(/more decimal places than/);
  });
});

describe("an allowed asset with no cap is uncapped, and must be opted into", () => {
  it("refuses a second asset that max_amount does not cover", () => {
    expect(() =>
      parsePolicy({
        ...base,
        max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
        allowed_assets: [usdcAsset, daiAsset],
      }),
    ).toThrow(/no cap covers/);
  });

  it("accepts it when the policy says so explicitly", () => {
    expect(() =>
      parsePolicy({
        ...base,
        allow_uncapped_assets: true,
        max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
        allowed_assets: [usdcAsset, daiAsset],
      }),
    ).not.toThrow();
  });
});

describe("duplicate symbols, and the unit the ceiling is computed in", () => {
  it("refuses two entries with the same symbol and different decimals", () => {
    // The hole in the first fix: checks identified an asset by symbol, so a second "USDC"
    // at 2 decimals was neither capped nor caught. On that entry, 40,000 atomic units
    // (400.00 tokens) was judged `pay` against a 0.05 cap — 8,000x over.
    expect(() =>
      parsePolicy({
        ...base,
        allow_uncapped_assets: true,
        max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
        allowed_assets: [
          usdcAsset,
          { symbol: "USDC", decimals: 2, address: "0x2222222222222222222222222222222222222222", network: "eip155:8453" },
        ],
      }),
    ).toThrow(/duplicate asset .*USDC@eip155:8453/i);
  });
});

describe("the same ticker on different chains is not a duplicate", () => {
  it("accepts USDC on mainnet and USDC on Sepolia", () => {
    // CI caught the first version of this rule rejecting a real fixture: a ticker is only
    // ambiguous within one chain, and cross-chain USDC is a normal policy.
    expect(() =>
      parsePolicy({
        ...base,
        allowed_networks: ["eip155:8453", "eip155:84532"],
        allow_uncapped_assets: true,
        max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
        allowed_assets: [
          usdcAsset,
          { symbol: "USDC", decimals: 6, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", network: "eip155:84532" },
        ],
      }),
    ).not.toThrow();
  });
});
