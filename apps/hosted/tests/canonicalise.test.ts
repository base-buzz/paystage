import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/receipt.js";

/**
 * #61 — a receipt digest is only reproducible if canonicalisation is exactly reproducible. Two implementations that
 * disagree about key order produce two different hashes for the same receipt, and the verifier reports "invalid" for a
 * genuine artefact. These are properties over generated values, not three hand-picked examples.
 */

/** Deterministic pseudo-random generator: a failing case is reproducible from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function value(next: () => number, depth = 0): unknown {
  const pick = Math.floor(next() * (depth > 2 ? 4 : 6));
  const str = () => ["a", "b", "", "zz", "0", "USDC"][Math.floor(next() * 6)]!;
  switch (pick) {
    case 0:
      return str();
    case 1:
      return Math.floor(next() * 1e6) - 5e5;
    case 2:
      return next() > 0.5;
    case 3:
      return null;
    case 4: {
      const n = Math.floor(next() * 4);
      return Array.from({ length: n }, () => value(next, depth + 1));
    }
    default: {
      const n = Math.floor(next() * 4);
      const out: Record<string, unknown> = {};
      for (let i = 0; i < n; i += 1) out[`k${Math.floor(next() * 5)}`] = value(next, depth + 1);
      return out;
    }
  }
}

function shuffledKeys(original: unknown, next: () => number): unknown {
  if (Array.isArray(original)) return original.map((v) => shuffledKeys(v, next));
  if (original && typeof original === "object") {
    const entries = Object.entries(original as Record<string, unknown>);
    for (let i = entries.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [entries[i], entries[j]] = [entries[j]!, entries[i]!];
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, shuffledKeys(v, next)]));
  }
  return original;
}

describe("canonicalize — properties, not examples", () => {
  it("key order never changes the bytes", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = rng(seed);
      const original = value(next);
      const permuted = shuffledKeys(original, rng(seed * 7 + 1));
      expect(canonicalize(permuted), `seed ${seed}`).toBe(canonicalize(original));
    }
  });

  it("round-trips through JSON without changing the bytes", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = rng(seed);
      const original = value(next);
      const text = canonicalize(original);
      expect(canonicalize(JSON.parse(text)), `seed ${seed}`).toBe(text);
    }
  });

  it("is stable across repeated calls", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const original = value(rng(seed));
      expect(canonicalize(original)).toBe(canonicalize(original));
    }
  });

  it("omits undefined members rather than emitting them as null", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
