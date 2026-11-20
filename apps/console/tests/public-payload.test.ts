import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * No public payload may serve an address we do not operate.
 *
 * `/api/metrics` was returning `payer` for every settled event. Today the only value is our own loadgen wallet, so it looked harmless — and the moment one external payer arrived it would
 * have published a stranger's pseudonym, which `docs/first-payer.md` refuses. A rule that holds by luck of who has paid so far is not a rule.
 *
 * This is a static check over the payload mappers rather than a live fetch: CI cannot reach the deployed site and should not need to. It asserts that the only `payer:` value served is
 * gated by `isOurs`, so the fix cannot be undone by deleting one line.
 */
const METRICS = join(__dirname, "..", "src", "lib", "metrics.ts");

describe("public payloads", () => {
  it("serves a payer address only when it is one of ours", () => {
    const src = readFileSync(METRICS, "utf8");
    const assignments = [...src.matchAll(/payer:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    expect(assignments.length).toBeGreaterThan(0);
    for (const value of assignments) {
      // The exempt one is the internal row type, which is never served; every served value must be gated.
      expect(value, `payer is served ungated: ${value}`).toMatch(/isOurs|string \| null|row\.payer \?\?/);
    }
    const served = assignments.filter((v) => v.startsWith("isOurs"));
    expect(served.length, "the served payer must be gated by isOurs").toBeGreaterThan(0);
  });

  it("has no other public route that returns an address-shaped field", () => {
    const apiDir = join(__dirname, "..", "src", "app", "api");
    const offenders: string[] = [];
    for (const dir of readdirSync(apiDir)) {
      const file = join(apiDir, dir, "route.ts");
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      // A route that both serves JSON and names a payer/address field is the shape to catch.
      if (/NextResponse\.json/.test(src) && /\bpayer\b/.test(src) && !/isOurs/.test(src)) offenders.push(dir);
    }
    expect(offenders, `routes serving payer without a gate: ${offenders.join(", ")}`).toEqual([]);
  });
});
