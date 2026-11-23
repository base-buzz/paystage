import { describe, expect, it } from "vitest";
import { severityOfDefault } from "../src/onreview-probe.js";

/**
 * Pins the current default so the next major is a decision rather than a drift.
 *
 * A test that asserted `"pay"` would read as endorsement. This asserts the *value* and names it in the test title as the thing to change, and the sibling
 * assertion records where the contradiction lives, so deleting either line is a deliberate act with a failing test attached.
 */
describe("onReview default", () => {
  it("is 'pay' today — the value the next major must change to 'refuse'", () => {
    expect(severityOfDefault()).toBe("pay");
  });

  it("is documented as contradicting the skill's 'review means stop' instruction", () => {
    // The doc lives in packages/x402-guard/README.md under "onReview — the default that contradicts our own skill".
    expect(severityOfDefault({ explicit: "refuse" })).toBe("refuse");
  });
});
