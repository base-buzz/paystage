import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PASS_TOKENS, POSTER_TINTS, passFaceSvg, tintFor } from "../../../scripts/lib/pass-face.mjs";

/**
 * The page and the pass read one token file (#440) — structurally, not visually.
 *
 * This test is plain JS on purpose: `scripts/lib/pass-face.mjs` is ESM, and a `.ts` test would either need a
 * declaration file for it or would have to copy its values. It runs in the same node process as the page's test
 * suite, imports the renderer itself, and reads the exact JSON the page imports, so "they match" is a comparison of
 * one file with itself rather than two transcriptions a reviewer has to eyeball.
 *
 * If someone converts `pass-tokens.json` back to `.ts`, the renderer can no longer import it and this test fails at
 * the import — which is the point.
 */

const HERE = import.meta.dirname;
const TOKENS_PATH = join(HERE, "../src/lib/pass-tokens.json");
const pageTokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));

/** The renderer's `f(n)` at width 750: n% of the pass width, rounded to 2 dp, exactly as `passFaceSvg` builds it. */
const f = (n) => Math.round(n * 7.5 * 100) / 100;

function render(overrides = {}) {
  return passFaceSvg({
    width: 750,
    state: "ACTIVE",
    limit: "$2.00",
    window: "$20.00 per 24h",
    expiry: "31 Jan 2027",
    principal: "Northwind Ltd",
    serial: "vch-7F3",
    teammate: { name: "Grok Bot", platform: "Grok", category: "research" },
    ...overrides,
  });
}

describe("one token file, read by both runtimes", () => {
  it("the renderer's import and the page's file are the same values", () => {
    expect(PASS_TOKENS).toEqual(pageTokens);
  });

  it("keeps the palette the pass and the page share", () => {
    expect(pageTokens.palette).toEqual({
      ink: "#101322",
      paper: "#FFFFFF",
      deep: "#1A1F71",
      gold: "#F7B600",
      muted: "#5B6472",
      red: "#B42318",
    });
  });

  it("keeps all seven poster tints, in one order", () => {
    expect(pageTokens.posterTints).toHaveLength(7);
    expect(POSTER_TINTS).toEqual(pageTokens.posterTints);
  });

  it("gives a pass with no teammate name the same tint the page uses", () => {
    // The mandate endpoint returns no name (#423), so the page uses posterTints[0]. The renderer's hash of an empty
    // name must land on the same array slot, or a nameless pass and the page would be different colours.
    expect(tintFor("")).toBe(pageTokens.posterTints[0]);
  });

  it("renders the name, value and label sizes from the tokens, not from literals", () => {
    const svg = render();

    expect(pageTokens.type.name).toBeGreaterThan(pageTokens.type.value);
    expect(pageTokens.type.value).toBeGreaterThan(pageTokens.type.label);

    // Built from the token value, so moving a token in the JSON moves the expected attribute with it; a renderer
    // that kept a literal would stop matching the file.
    expect(svg).toContain(`font-size="${f(pageTokens.type.name)}"`);
    expect(svg).toContain(`Grok Bot`);
    expect(svg).toContain(`font-size="${f(pageTokens.type.value)}"`);
    expect(svg).toContain(`$2.00`);
    expect(svg).toContain(`font-size="${f(pageTokens.type.label)}"`);
    expect(svg).toContain("UP TO");
  });

  it("takes the pass height and poster band from the geometry tokens", () => {
    const bare = render({ teammate: undefined });
    const width = 750;
    const height = Math.round(width * pageTokens.geometry.aspect);
    const posterH = Math.round(height * pageTokens.geometry.posterShareBare);

    expect(bare).toContain(`width="${width}" height="${height}"`);
    expect(bare).toContain(`<rect x="0" y="0" width="${width}" height="${posterH}"`);
  });

  it("takes the pad ratio from the spacing token", () => {
    const svg = render();
    expect(svg).toContain(`x="${Math.round(750 * pageTokens.spacing.pad)}"`);
  });
});

describe("both sides point at that file, not at a copy", () => {
  it("the page-side module imports the JSON", () => {
    const source = readFileSync(join(HERE, "../src/lib/pass-tokens.ts"), "utf8");
    expect(source).toMatch(/from "\.\/pass-tokens\.json"/);
  });

  it("the card takes its tokens from the shared token-CSS module", () => {
    const source = readFileSync(join(HERE, "../src/components/MandateCard.tsx"), "utf8");
    expect(source).toMatch(/from "@\/lib\/pass-token-css"/);
    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/); // no palette literal typed into the component
  });

  it("the shared token-CSS module reads the page-side module", () => {
    const source = readFileSync(join(HERE, "../src/lib/pass-token-css.ts"), "utf8");
    expect(source).toMatch(/from "@\/lib\/pass-tokens"/);
    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/); // no second palette typed into a page
  });

  it("the renderer imports the same JSON, as JSON", () => {
    const source = readFileSync(join(HERE, "../../../scripts/lib/pass-face.mjs"), "utf8");
    expect(source).toMatch(/apps\/console\/src\/lib\/pass-tokens\.json" with \{ type: "json" \}/);
  });
});
