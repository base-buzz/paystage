import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Discovery section and `scripts/check-agent-surfaces.mjs` read one file. These assertions
 * keep the generated file shaped like a roster, so a probe change cannot silently drop a product
 * or introduce a state the page does not know how to render.
 */
const data = JSON.parse(
  readFileSync(join(process.cwd(), "../../docs/state/agent-surfaces.json"), "utf8"),
) as {
  endpoint: { url: string };
  counts: Record<string, number>;
  products: Array<{
    id: string;
    product: string;
    category: string;
    state: string;
    reason: string;
    checkedAt: string;
    sources: Array<{ url: string }>;
  }>;
};

const STATES = ["reachable", "documented-not-listed", "no-mcp", "unverified"];
const ROSTER = [
  "Grok Bot",
  "OpenAI Dots",
  "Meta Muse",
  "Anthropic Claude Duet",
  "Manus / Cue",
  "OpenMausBot",
  "OpenClaw / Hermes Agent",
  "OpenBot / Rakazo",
];

describe("agent surfaces roster", () => {
  it("keeps the operator's eight products, once each", () => {
    expect(data.products.map((product) => product.product)).toEqual(ROSTER);
    expect(new Set(data.products.map((product) => product.id)).size).toBe(ROSTER.length);
  });

  it("uses only the four documented states and never leaves a state unexplained", () => {
    for (const product of data.products) {
      expect(STATES).toContain(product.state);
      expect(product.reason.trim().length).toBeGreaterThan(0);
      expect(product.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("points every row at a primary source and the page at the canonical endpoint", () => {
    expect(data.endpoint.url).toBe("https://api.paystage.xyz/mcp");
    for (const product of data.products) {
      expect(product.sources.length).toBeGreaterThan(0);
      for (const source of product.sources) expect(source.url).toMatch(/^https:\/\//);
    }
  });

  it("publishes counts that add up to the roster", () => {
    const total = STATES.reduce((sum, state) => sum + (data.counts[state] ?? 0), 0);
    expect(total).toBe(data.products.length);
  });
});
