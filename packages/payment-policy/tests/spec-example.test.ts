import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/index.js";
import { readText } from "./helpers.js";

/**
 * The draft lives in the operator tree (`/work/ops`), not inside this repository, so this
 * provenance check runs where the draft is present and skips elsewhere. The fixture itself is
 * checked in, which is what CI needs; this test is what keeps the two from drifting locally.
 */
const DRAFT = fileURLToPath(
  new URL("../../../../ops/docs/specs/x402-extension-payment-policy.md", import.meta.url),
);

function draftExample(): unknown {
  const markdown = readFileSync(DRAFT, "utf8");
  const block = /## `PaymentRequired`[\s\S]*?```json\n([\s\S]*?)```/.exec(markdown)?.[1];
  if (!block) throw new Error(`no PaymentRequired JSON block in ${DRAFT}`);
  const paymentRequired = JSON.parse(block) as {
    extensions?: Record<string, { info?: unknown }>;
  };
  return paymentRequired.extensions?.["payment-policy"]?.info;
}

describe("the spec draft's example policy", () => {
  const text = readText("documents", "spec-example.json");
  const document = JSON.parse(text) as { version: number; rules: Record<string, unknown> };

  it("parses and validates against @paystage/policy", () => {
    expect(() => parsePolicy(text)).not.toThrow();
    const policy = parsePolicy(text);
    expect(policy.version).toBe(1);
    expect(policy.max_amount).toEqual({ value: "1.00", asset: "USDC", decimals: 6 });
    expect(policy.allowed_networks).toEqual(["eip155:8453"]);
    expect(policy.unknown_payee).toBe("review");
    expect(policy.velocity?.windows[0]).toMatchObject({ window_seconds: 86400, max_count: 100 });
  });

  it.skipIf(!existsSync(DRAFT))("is copied verbatim from the draft's PaymentRequired example", () => {
    expect(document).toEqual(draftExample());
  });

  /**
   * The finding that item #342 produced: the draft's example used a flat velocity object,
   * `{ window_seconds, max_count, max_amount }`, while @paystage/policy v1 has always required
   * `{ windows: [ ... ] }`. The parser was right; the draft was fixed. This test pins the old
   * example's exact failure so a later edit cannot quietly reintroduce it.
   */
  it("the pre-fix example failed on velocity.windows, and only there", () => {
    let issues: Array<{ path: Array<string | number> }> | undefined;
    try {
      parsePolicy(readText("spec", "spec-example.pre-fix.json"));
    } catch (error) {
      issues = (error as { issues?: Array<{ path: Array<string | number> }> }).issues;
    }
    expect(issues?.map((issue) => issue.path.join("."))).toEqual(["velocity.windows"]);
  });
});
