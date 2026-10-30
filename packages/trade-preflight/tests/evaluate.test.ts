import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateTrade } from "../src/evaluate.js";
import { parseTradePolicy } from "../src/policy.js";
import type { Snapshot, TradeProposal } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "xyz-meta.json");
const fixtureRaw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  meta: Snapshot["meta"];
  assetCtxs: Snapshot["assetCtxs"];
};

function makeSnapshot(): Snapshot {
  // Deep clone so tests can mutate freely.
  return {
    dex: "xyz",
    meta: JSON.parse(JSON.stringify(fixtureRaw.meta)),
    assetCtxs: JSON.parse(JSON.stringify(fixtureRaw.assetCtxs)),
  };
}

const basePolicy = parseTradePolicy({
  version: 1,
  allowed_dexes: ["xyz"],
  allowed_assets: ["xyz:TSLA", "xyz:NVDA", "xyz:GOLD"],
  max_notional_usdc: "10000",
  max_leverage: 10,
  max_abs_funding: "0.0001",
  require_review_above_notional_usdc: "5000",
  unknown_asset: "do_not_trade",
});

function proposal(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    dex: "xyz",
    asset: "xyz:TSLA",
    side: "buy",
    size: "1",
    leverage: 1,
    ...overrides,
  };
}

describe("evaluateTrade", () => {
  it("allows a small buy of xyz:TSLA within policy", () => {
    const result = evaluateTrade(proposal(), makeSnapshot(), basePolicy);
    expect(result.decision).toBe("allow");
    expect(result.asset).toBe("xyz:TSLA");
    expect(result.markPx).toBe("396.11");
    expect(result.notionalUsdc).toBeDefined();
    // 1 * 396.11 = 396.11
    expect(Number(result.notionalUsdc)).toBeCloseTo(396.11, 5);
  });

  it("do_not_trade for unknown asset xyz:FAKE", () => {
    const result = evaluateTrade(
      proposal({ asset: "xyz:FAKE" }),
      makeSnapshot(),
      basePolicy,
    );
    expect(result.decision).toBe("do_not_trade");
    expect(result.reasons.join(" ")).toMatch(/not found|not in allowed_assets/);
  });

  it("do_not_trade when notional exceeds max_notional_usdc", () => {
    // 100 * 396.11 = 39611 > 10000
    const result = evaluateTrade(
      proposal({ size: "100" }),
      makeSnapshot(),
      basePolicy,
    );
    expect(result.decision).toBe("do_not_trade");
    expect(result.reasons.join(" ")).toMatch(/exceeds max_notional_usdc/);
  });

  it("review when funding exceeds max_abs_funding", () => {
    const snap = makeSnapshot();
    // TSLA is index 0
    snap.assetCtxs[0].funding = "0.01";
    const result = evaluateTrade(proposal(), snap, basePolicy);
    expect(result.decision).toBe("review");
    expect(result.reasons.join(" ")).toMatch(/max_abs_funding/);
  });

  it("do_not_trade when leverage exceeds policy max_leverage", () => {
    const result = evaluateTrade(
      proposal({ leverage: 50 }),
      makeSnapshot(),
      basePolicy,
    );
    expect(result.decision).toBe("do_not_trade");
    expect(result.reasons.join(" ")).toMatch(/max_leverage/);
  });

  it("do_not_trade when leverage exceeds asset maxLeverage", () => {
    // GOLD has maxLeverage 25; policy max_leverage is 10 so bump policy to 30
    const policy = parseTradePolicy({
      ...basePolicy,
      max_leverage: 30,
    });
    const result = evaluateTrade(
      proposal({ asset: "xyz:GOLD", leverage: 26 }),
      makeSnapshot(),
      policy,
    );
    expect(result.decision).toBe("do_not_trade");
    expect(result.reasons.join(" ")).toMatch(/asset maxLeverage/);
  });

  it("review when notional exceeds require_review_above_notional_usdc but under max", () => {
    // 20 * 396.11 = 7922.2 > 5000, < 10000
    const result = evaluateTrade(
      proposal({ size: "20" }),
      makeSnapshot(),
      basePolicy,
    );
    expect(result.decision).toBe("review");
    expect(result.reasons.join(" ")).toMatch(
      /require_review_above_notional_usdc/,
    );
  });

  it("do_not_trade when dex not allowed", () => {
    const result = evaluateTrade(
      proposal({ dex: "other" }),
      makeSnapshot(),
      basePolicy,
    );
    expect(result.decision).toBe("do_not_trade");
    expect(result.reasons.join(" ")).toMatch(/not in allowed_dexes/);
  });

  it("do_not_trade when asset not in allowed_assets", () => {
    const policy = parseTradePolicy({
      ...basePolicy,
      allowed_assets: ["xyz:TSLA"],
    });
    const result = evaluateTrade(
      proposal({ asset: "xyz:NVDA" }),
      makeSnapshot(),
      policy,
    );
    expect(result.decision).toBe("do_not_trade");
    expect(result.reasons.join(" ")).toMatch(/not in allowed_assets/);
  });

  it("aggregates: do_not_trade wins over review", () => {
    const snap = makeSnapshot();
    snap.assetCtxs[0].funding = "0.01"; // would be review
    const result = evaluateTrade(
      proposal({ size: "100" }), // would be do_not_trade
      snap,
      basePolicy,
    );
    expect(result.decision).toBe("do_not_trade");
  });
});
