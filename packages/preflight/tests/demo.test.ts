import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEMO_CHALLENGES,
  DEMO_POLICY,
  PREFLIGHT_VERSION,
  renderDemo,
  ruleLine,
  runDemo,
} from "../src/demo";
import { evaluatePayment } from "../src/evaluate";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string };

describe("demo", () => {
  const results = runDemo();

  it("covers all three verdicts", () => {
    expect(new Set(results.map((r) => r.decision))).toEqual(
      new Set(["pay", "review", "do_not_pay"]),
    );
  });

  it("the allowed payment is `pay` with no rule fired", () => {
    const allowed = results.find((r) => r.id === "allowlisted");
    expect(allowed).toBeDefined();
    expect(allowed!.decision).toBe("pay");
    expect(allowed!.reasons).toEqual([]);
    expect(ruleLine(allowed!)).toMatch(/none/);
  });

  it("the unknown payee is `review` for the payee-allowlist reason", () => {
    const review = results.find((r) => r.id === "unknown-payee");
    expect(review).toBeDefined();
    expect(review!.decision).toBe("review");
    expect(
      review!.reasons.some((reason) =>
        reason.includes("not in allowed_pay_to (review)"),
      ),
    ).toBe(true);
    // The demo must not drift from the evaluator: re-running the same request gives the same verdict.
    expect(evaluatePayment(review!.request, DEMO_POLICY).decision).toBe("review");
  });

  it("the known drainer is `do_not_pay` with the evaluator's `known drainer` reason", () => {
    const drainer = results.find((r) => r.id === "known-drainer");
    expect(drainer).toBeDefined();
    expect(drainer!.decision).toBe("do_not_pay");
    expect(drainer!.reasons).toContain("known drainer");
  });

  it("the sanctioned payee is `do_not_pay` with the OFAC reason", () => {
    const sanctioned = results.find((r) => r.id === "sanctioned");
    expect(sanctioned).toBeDefined();
    expect(sanctioned!.decision).toBe("do_not_pay");
    expect(sanctioned!.reasons).toContain("sanctioned address (OFAC SDN)");
  });

  it("is deterministic: two runs agree", () => {
    expect(runDemo()).toEqual(results);
  });

  it("prints the version and stays under the 40-line budget", () => {
    const output = renderDemo();
    expect(output).toContain(PREFLIGHT_VERSION);
    expect(output).toContain("Offline and free");
    expect(output.split("\n").length).toBeLessThanOrEqual(40);
    for (const verdict of ["pay", "review", "do_not_pay"]) {
      expect(output).toContain(`verdict: ${verdict}`);
    }
  });

  it("prints the evaluator snippet and the MCP path", () => {
    const output = renderDemo();
    expect(output).toContain("evaluatePayment(paymentRequired, policy)");
    expect(output).toContain("npx -y @paystage/preflight");
  });

  it("version constant matches the package manifest", () => {
    expect(PREFLIGHT_VERSION).toBe(manifest.version);
  });

  it("has no environment or network access in the demo source", () => {
    const source = readFileSync(join(here, "..", "src", "demo.ts"), "utf8");
    // A regression guard, not a proof: the offline claim is also checked by running the built bin
    // with `env -i`, which is the check that would actually catch an added fetch.
    expect(source).not.toMatch(/\bprocess\.env\b/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/node:(?:http|https|net|dns|tls)/);
    expect(source).not.toMatch(/from\s+["'](?:https?|node:http|node:net|node:dns)/);
    expect(DEMO_CHALLENGES.length).toBeGreaterThanOrEqual(3);
  });
});
