import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MissingField,
  formatAtomic,
  humanLine,
  medianAtomic,
  parseArgs,
  recordFromBundle,
  redactSerial,
  summarize,
  type RefusalRecord,
} from "../../../scripts/refusal-summary.mjs";

/**
 * #433. The refusal summary counts what a mandate stopped, from the stored record alone.
 *
 * The cases below are the ones that make the number honest rather than merely nonzero:
 * a `review` is not a refusal, a receipt with no rule is its own bucket rather than a guess,
 * the previous window is excluded by the boundary rather than by the query's mood, and an
 * unreadable source exits non-zero instead of printing zeros.
 */

const WINDOW = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-08T00:00:00.000Z" };

function record(overrides: Partial<RefusalRecord> = {}): RefusalRecord {
  return {
    at: "2026-11-03T12:00:00.000Z",
    decision: "do_not_pay",
    rule: "amount 12.5 USDC exceeds max_amount 5 USDC",
    payee: "0x000000000000000000000000000000000000dEaD",
    amountAtomic: "12500000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetSymbol: "USDC",
    decimals: 6,
    serial: null,
    policySha256: "a".repeat(64),
    hasReceipt: true,
    hasPayment: true,
    ...overrides,
  };
}

const RECEIPT = {
  issued_at: "2026-11-03T12:00:00.000Z",
  policy_sha256: "b".repeat(64),
  verdict: { decision: "do_not_pay", reasons: ["known drainer"] },
  payment: { amount: "2000", payee: "0x1111111111111111111111111111111111111111", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "c".repeat(64),
    decision: "do_not_pay",
    created_at: "2026-11-03T12:00:00.050Z",
    receipt: JSON.stringify(RECEIPT),
    proof: JSON.stringify({
      hashes: { policy_sha256: "b".repeat(64) },
      inputs: {
        options: { now: "2026-11-03T12:00:00.000Z" },
        policy: {
          allowed_assets: [
            { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
          ],
        },
      },
    }),
    ...overrides,
  };
}

describe("summarize", () => {
  it("never counts a review as a refusal", () => {
    const report = summarize(
      [record({ decision: "review", rule: "address-risk check could not complete (gopluslabs)" })],
      WINDOW,
    );

    expect(report.refusals).toBe(0);
    expect(report.reviews).toBe(1);
    expect(report.by_rule).toEqual([]);
    expect(report.by_payee).toEqual([]);
    expect(report.amounts).toEqual({ total: "0", median: null, asset: null });
  });

  it("puts a refusal with no reasons in its own unspecified bucket", () => {
    const receiptless = recordFromBundle(
      row({
        receipt: JSON.stringify({
          issued_at: "2026-11-03T12:00:00.000Z",
          verdict: { decision: "do_not_pay", reasons: [] },
        }),
      }),
    );
    expect(receiptless.rule).toBe("unspecified");

    const report = summarize([receiptless], WINDOW);
    expect(report.refusals).toBe(1);
    expect(report.by_rule).toEqual([{ rule: "unspecified", count: 1 }]);
  });

  it("excludes the previous window from the current counts and calculates the delta from it", () => {
    const previous = record({ at: "2026-10-31T23:59:59.999Z" });
    const atFrom = record({ at: WINDOW.from });
    const beforeTo = record({ at: "2026-11-07T23:59:59.999Z" });
    const atTo = record({ at: WINDOW.to });

    const report = summarize([previous, atFrom, beforeTo, atTo], WINDOW);

    // `from` is inclusive, `to` is exclusive: the record at `to` belongs to the next period.
    expect(report.refusals).toBe(2);
    expect(report.previous_period_delta.refusals).toBe(1);
    expect(report.previous_period_delta.pct).toBe(100);
  });

  it("does not invent a percentage when the previous period had no refusals", () => {
    const report = summarize([record()], WINDOW);
    expect(report.previous_period_delta).toEqual({ refusals: 0, pct: null });
  });

  it("names a refusal it cannot value instead of dropping it from the count", () => {
    const report = summarize(
      [record(), record({ amountAtomic: null, hasPayment: false, payee: null })],
      WINDOW,
    );

    expect(report.refusals).toBe(2);
    expect(report.without_payment).toBe(1);
    expect(report.amounts.total).toBe("12.5");
    expect(report.by_payee).toEqual([
      { payee: "0x000000000000000000000000000000000000dEaD", count: 1, amount_total: "12.5" },
    ]);
  });

  it("refuses a single total when the period spans more than one asset", () => {
    const otherAsset = record({
      asset: "0x0000000000000000000000000000000000000001",
      payee: "0x2222222222222222222222222222222222222222",
    });
    expect(() => summarize([record(), otherAsset], WINDOW)).toThrow(MissingField);
  });
});

describe("recordFromBundle", () => {
  it("prefers the receipt for decision, rule, payment and time", () => {
    const read = recordFromBundle(row());
    expect(read.decision).toBe("do_not_pay");
    expect(read.rule).toBe("known drainer");
    expect(read.amountAtomic).toBe("2000");
    expect(read.decimals).toBe(6);
    expect(read.assetSymbol).toBe("USDC");
    expect(read.at).toBe("2026-11-03T12:00:00.000Z");
    expect(read.hasReceipt).toBe(true);
  });

  it("reads a bundle with no receipt from its own proof, and marks that it had none", () => {
    const read = recordFromBundle(
      row({
        receipt: null,
        proof: JSON.stringify({
          hashes: { policy_sha256: "d".repeat(64) },
          inputs: {
            options: { now: "2026-11-04T00:00:00.000Z" },
            policy: {
              allowed_assets: [
                { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
              ],
            },
          },
          verdict: {
            decision: "do_not_pay",
            reasons: ["payTo 0x6160…3757 not in allowed_pay_to (deny)"],
            selected_accept: {
              amount: "12500000",
              payTo: "0x6160000000000000000000000000000000003757",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              network: "eip155:8453",
            },
          },
        }),
      }),
    );

    expect(read.hasReceipt).toBe(false);
    expect(read.rule).toBe("payTo 0x6160…3757 not in allowed_pay_to (deny)");
    expect(read.amountAtomic).toBe("12500000");
    expect(read.payee).toBe("0x6160000000000000000000000000000000003757");
    expect(read.policySha256).toBe("d".repeat(64));
  });

  it("fails naming the field when neither the receipt nor the proof carries a decision", () => {
    expect(() => recordFromBundle(row({ decision: null, receipt: "null", proof: "{}" }))).toThrow(
      /evidence_bundles\.decision/,
    );
  });
});

describe("amount formatting", () => {
  it("formats atomic units with the policy's decimals and trims trailing zeros", () => {
    expect(formatAtomic("12500000", 6)).toBe("12.5");
    expect(formatAtomic("2000", 6)).toBe("0.002");
    expect(formatAtomic("0", 6)).toBe("0");
    expect(formatAtomic("1", 0)).toBe("1");
  });

  it("calculates an exact median, including the even-count half unit", () => {
    expect(medianAtomic(["1000000", "3000000", "2000000"], 6)).toBe("2");
    expect(medianAtomic(["1000000", "2000000"], 6)).toBe("1.5");
    expect(medianAtomic([], 6)).toBeNull();
  });
});

describe("CLI contract", () => {
  it("exits 2 on an unreadable source rather than printing zeros", () => {
    const script = fileURLToPath(new URL("../../../scripts/refusal-summary.mjs", import.meta.url));
    const env = { ...process.env };
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;

    const result = spawnSync(process.execPath, [script, "--days", "30", "--json"], {
      encoding: "utf8",
      env,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/SUPABASE_URL/);
    expect(result.stdout).not.toContain('"refusals"');
  });

  it("rejects an unknown flag instead of silently ignoring it", () => {
    expect(() => parseArgs(["--dayz", "30"])).toThrow(MissingField);
  });

  it("redacts a serial to a short code for display, and keeps null as null", () => {
    expect(redactSerial("vch-ABC123")).toBe("vch-123");
    expect(redactSerial("0123456789abcdef")).toBe("…def");
    expect(redactSerial(null)).toBeNull();
  });

  it("mentions reviews as a separate number in the human line", () => {
    const line = humanLine(
      summarize([record({ decision: "review" }), record()], WINDOW),
      "policy abc…",
    );
    expect(line).toContain("1 refusals");
    expect(line).toContain("1 reviews");
    expect(line).toContain("policy abc…");
  });
});
