import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/load.js";

/**
 * The `invalid policy:` text is user-facing: `@paystage/x402-guard` wraps it, the MCP
 * `validate_policy` tool prints it, and the hosted route returns it. Whichever parser runs, a
 * rejected document must produce this exact text — so the messages were pinned *before* the
 * hand-written guards replaced zod (#181), and the differential test keeps them pinned.
 *
 * The literals below are the full `error.message` values, which are the pretty-printed issue
 * array rather than a sentence. That is what a caller sees today; shortening it would be a
 * behaviour change wearing better grammar.
 */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DAI = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
const PAY_TO = "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE";

function base(): Record<string, unknown> {
  return {
    version: 1,
    max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
    allowed_pay_to: [PAY_TO],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
    allowed_networks: ["eip155:8453"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  };
}

function messageOf(document: unknown): string {
  try {
    parsePolicy(document);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the policy to be rejected");
}

const ISSUE = (body: string): string => `[\n  {\n${body}\n  }\n]`;

describe("invalid policy: message preservation", () => {
  it("names a wrong version", () => {
    expect(messageOf({ ...base(), version: 2 })).toBe(
      ISSUE(`    "code": "invalid_value",
    "values": [
      1
    ],
    "path": [
      "version"
    ],
    "message": "Invalid input: expected 1"`));
  });

  it("names a wrong unknown_payee", () => {
    expect(messageOf({ ...base(), unknown_payee: "hold" })).toBe(
      ISSUE(`    "code": "invalid_value",
    "values": [
      "review",
      "deny"
    ],
    "path": [
      "unknown_payee"
    ],
    "message": "Invalid option: expected one of \\"review\\"|\\"deny\\""`));
  });

  it("names a missing max_amount", () => {
    const document = base();
    delete document.max_amount;
    expect(messageOf(document)).toBe(
      ISSUE(`    "expected": "object",
    "code": "invalid_type",
    "path": [
      "max_amount"
    ],
    "message": "Invalid input: expected object, received undefined"`));
  });

  it("keeps the amount-value sentence and its pattern", () => {
    expect(messageOf({ ...base(), max_amount: { value: "lots", asset: "USDC", decimals: 6 } })).toBe(
      ISSUE(`    "origin": "string",
    "code": "invalid_format",
    "format": "regex",
    "pattern": "/^\\\\d+(?:\\\\.\\\\d+)?$/",
    "path": [
      "max_amount",
      "value"
    ],
    "message": "Amount value must be a non-negative decimal string"`));
  });

  it("keeps the address sentence", () => {
    expect(messageOf({ ...base(), allowed_pay_to: ["0x123"] })).toBe(
      ISSUE(`    "origin": "string",
    "code": "invalid_format",
    "format": "regex",
    "pattern": "/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/",
    "path": [
      "allowed_pay_to",
      0
    ],
    "message": "Expected a 0x-prefixed Ethereum address or a base58 Solana address"`));
  });

  it("keeps a negative number's too-small issue", () => {
    expect(messageOf({ ...base(), max_timeout_seconds: 0 })).toBe(
      ISSUE(`    "origin": "number",
    "code": "too_small",
    "minimum": 0,
    "inclusive": false,
    "path": [
      "max_timeout_seconds"
    ],
    "message": "Too small: expected number to be >0"`));
  });

  it("keeps an empty allow-list's too-small issue", () => {
    expect(messageOf({ ...base(), allowed_pay_to: [] })).toBe(
      ISSUE(`    "origin": "array",
    "code": "too_small",
    "minimum": 1,
    "inclusive": true,
    "path": [
      "allowed_pay_to"
    ],
    "message": "Too small: expected array to have >=1 items"`));
  });

  it("keeps the time_window exactly-one message", () => {
    expect(
      messageOf({
        ...base(),
        time_window: { allowed_hours_utc: [9, 17], blocked_hours_utc: [12, 13] },
      }),
    ).toBe(
      ISSUE(`    "code": "custom",
    "path": [
      "time_window"
    ],
    "message": "time_window needs exactly one of allowed_hours_utc or blocked_hours_utc"`));
  });

  it("keeps the decimals-mismatch sentence, including the factor direction", () => {
    expect(messageOf({ ...base(), max_amount: { value: "0.05", asset: "USDC", decimals: 18 } })).toBe(
      ISSUE(`    "code": "custom",
    "path": [
      "max_amount",
      "decimals"
    ],
    "message": "max_amount.decimals is 18 but asset \\"USDC\\" has 6 decimals — the cap would be 10^12 times too large"`));
  });

  it("keeps the duplicate-asset sentence", () => {
    expect(
      messageOf({
        ...base(),
        allow_uncapped_assets: true,
        allowed_assets: [
          { symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" },
          { symbol: "USDC", decimals: 2, address: "0x2222222222222222222222222222222222222222", network: "eip155:8453" },
        ],
      }),
    ).toBe(
      ISSUE(`    "code": "custom",
    "path": [
      "allowed_assets"
    ],
    "message": "duplicate asset \\"USDC@eip155:8453\\" — same ticker on the same chain; rename one if they are genuinely different assets"`));
  });

  it("keeps the uncapped-asset sentence, and names both sides", () => {
    expect(
      messageOf({
        ...base(),
        allowed_assets: [
          { symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" },
          { symbol: "DAI", decimals: 18, address: DAI, network: "eip155:8453" },
        ],
      }),
    ).toBe(
      ISSUE(`    "code": "custom",
    "path": [
      "allowed_assets"
    ],
    "message": "allowed_assets includes \\"DAI\\", which no cap covers — max_amount only caps \\"USDC\\". Set allow_uncapped_assets: true if that is intended"`));
  });

  it("keeps the empty velocity-window issue", () => {
    expect(messageOf({ ...base(), velocity: { windows: [] } })).toBe(
      ISSUE(`    "origin": "array",
    "code": "too_small",
    "minimum": 1,
    "inclusive": true,
    "path": [
      "velocity",
      "windows"
    ],
    "message": "Too small: expected array to have >=1 items"`));
  });

  it("keeps the record-key issue for an empty agent id", () => {
    expect(messageOf({ ...base(), agents: { "": {} } })).toBe(
      ISSUE(`    "code": "invalid_key",
    "origin": "record",
    "issues": [
      {
        "origin": "string",
        "code": "too_small",
        "minimum": 1,
        "inclusive": true,
        "path": [],
        "message": "Too small: expected string to have >=1 characters"
      }
    ],
    "path": [
      "agents",
      ""
    ],
    "message": "Invalid key in record"`));
  });

  it("exposes the issue path list that @paystage/payment-policy reads", () => {
    let issues: Array<{ path: Array<string | number> }> | undefined;
    try {
      parsePolicy({ ...base(), velocity: { windows: [{}] } });
    } catch (error) {
      issues = (error as { issues?: Array<{ path: Array<string | number> }> }).issues;
    }
    expect(issues?.map((issue) => issue.path.join("."))).toEqual(["velocity.windows.0.window_seconds"]);
  });
});

describe("unknown keys are stripped, not rejected", () => {
  /**
   * This is what the parser does today, and it is a finding rather than a preference: zod
   * objects strip unknown keys unless `.strict()` is used, and none of the policy objects is
   * strict. `@paystage/payment-policy` is the layer that refuses unknown fields, by reading
   * `PolicySchema.shape`; the parser keeps unknown keys out of the result instead.
   *
   * Rejecting them here would be a regression for every document that currently parses, so the
   * hand-written guards reproduce the strip exactly.
   */
  it("drops unknown top-level and nested keys from the parsed result", () => {
    const parsed = parsePolicy({
      ...base(),
      name: "standard",
      max_amount: { value: "0.05", asset: "USDC", decimals: 6, comment: "cap" },
    }) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "allowed_assets",
      "allowed_networks",
      "allowed_pay_to",
      "max_amount",
      "max_timeout_seconds",
      "unknown_payee",
      "version",
    ]);
    expect(Object.keys(parsed.max_amount as Record<string, unknown>)).toEqual(["value", "asset", "decimals"]);
  });

  it("still rejects a document whose only content is unknown", () => {
    expect(() => parsePolicy({ nonsense: true })).toThrow(/max_amount/);
  });
});
