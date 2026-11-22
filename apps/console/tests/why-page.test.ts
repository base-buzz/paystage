import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * /why is the page a payments lawyer may read, and its acceptance criterion is the order of the
 * argument: the analogy, then the history, then the settlement, then the industry, then the spec,
 * then the public-good case. A later edit that moves a section, drops the no-membership sentence or
 * turns a source into plain text would still build, so the order and the disclosure are checked here.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "../src/app/why/page.tsx"), "utf8");

const HEADINGS = [
  "1. The two jobs",
  "2. The code that waited",
  "3. The 2026 settlement",
  "4. The industry is filling that seat from several directions",
  "5. What the spec already specifies",
  "6. Why an independent adjudicator is useful as a public good",
];

describe("/why page", () => {
  it("keeps the required section order", () => {
    const found = [...SOURCE.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
    expect(found).toEqual(HEADINGS);
  });

  it("makes the no-membership disclosure exactly once", () => {
    const occurrences = SOURCE.match(/not a member of the x402 Foundation/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("uses https for every external link", () => {
    const external = [...SOURCE.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(external.length).toBeGreaterThan(10);
    expect(external.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("links the funding document from the public-good section", () => {
    expect(SOURCE).toContain("docs/funding.md");
  });
});
