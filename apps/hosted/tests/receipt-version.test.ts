import { describe, it, expect } from "vitest";
import { buildReceipt } from "../src/receipt.js";

/**
 * `service.version` was "0.0.0" on every live receipt until 2026-11-12, because the only
 * production call site never passed it and the field defaulted to a placeholder. No test
 * read the field, which is why nothing caught it: an unobserved field is the same as a
 * missing one.
 */

const policy = { version: 1 };
const request = { x402Version: 2, accepts: [] };
const decision = { decision: "pay", reasons: [] };

describe("receipt service.version", () => {
  it("uses the supplied build version", async () => {
    const r = await buildReceipt({ decision, request, policy, serviceVersion: "2026.11.12" });
    expect(r.service.version).toBe("2026.11.12");
  });

  it("says 'unknown' rather than a placeholder that reads like a version", async () => {
    const r = await buildReceipt({ decision, request, policy });
    expect(r.service.version).toBe("unknown");
    expect(r.service.version).not.toMatch(/^\d+\.\d+\.\d+$/);
  });
});
