import { describe, expect, it } from "vitest";
import { normalizePaymentRequired } from "../src/index.js";

/**
 * #60. `normalizePaymentRequired` takes attacker-controlled JSON — it is the first thing a hostile 402 response touches.
 * It has example-based tests; this is a seeded fuzzer, so a failure is reproducible from its seed.
 *
 * What is asserted is deliberately weak: **the process survives, and nothing escapes uncaught**. A parser that throws a
 * named error on garbage is correct; one that throws a TypeError from deep inside, or returns a half-built object, is a
 * denial-of-service on every agent that trusts it.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const KEYS = [
  "x402Version", "accepts", "scheme", "network", "amount", "asset", "payTo",
  "maxTimeoutSeconds", "resource", "extra", "description", "mimeType",
];

/** Random JSON: nested, adversarial shapes, not just random bytes. */
function value(next: () => number, depth = 0): unknown {
  const pick = Math.floor(next() * (depth > 3 ? 5 : 8));
  switch (pick) {
    case 0: return null;
    case 1: return next() > 0.5;
    case 2: return Math.floor(next() * 2 ** 32) * (next() > 0.5 ? 1 : -1);
    case 3: return ["0", "", " ", "0x", "not-a-number", "1e309", "-1"][Math.floor(next() * 7)];
    case 4: return next() < 0.05 ? Number.MAX_SAFE_INTEGER * next() : Math.floor(next() * 1000);
    case 5: {
      const n = Math.floor(next() * 5);
      return Array.from({ length: n }, () => value(next, depth + 1));
    }
    case 6: {
      const out: Record<string, unknown> = {};
      const n = Math.floor(next() * 6);
      for (let i = 0; i < n; i += 1) out[KEYS[Math.floor(next() * KEYS.length)]!] = value(next, depth + 1);
      return out;
    }
    default: {
      // Structurally plausible but wrong: an `accepts` array of near-miss objects.
      const n = Math.floor(next() * 4);
      return {
        x402Version: Math.floor(next() * 5),
        accepts: Array.from({ length: n }, () => {
          const entry: Record<string, unknown> = {};
          for (const key of ["scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds", "extra"]) {
            if (next() > 0.3) entry[key] = value(next, depth + 2);
          }
          return entry;
        }),
      };
    }
  }
}

describe("normalizePaymentRequired — seeded fuzz", () => {
  it("survives 10,000 adversarial inputs without an uncaught throw", () => {
    const failures: Array<{ seed: number; error: string }> = [];
    for (let seed = 1; seed <= 10_000; seed += 1) {
      const input = value(rng(seed));
      try {
        const result = normalizePaymentRequired(input as never);
        // A returned value must be an object, not a primitive that callers would dereference.
        if (result !== null && typeof result === "object") continue;
        failures.push({ seed, error: `returned ${typeof result} instead of an object or a named error` });
      } catch (error) {
        // Throwing is allowed; throwing an unnameable internal error is not. The contract is "fail closed with a
        // message a caller can act on", so the message has to exist and not be a TypeErrors-from-nowhere.
        const message = error instanceof Error ? error.message : String(error);
        if (!message || /Cannot read propert|undefined is not|of null|not a function/.test(message)) {
          failures.push({ seed, error: message });
        }
      }
      if (failures.length > 3) break;
    }
    expect(failures, `reproduce with the seed: ${JSON.stringify(failures)}`).toEqual([]);
  });
});
