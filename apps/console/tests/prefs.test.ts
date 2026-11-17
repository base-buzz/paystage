import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PREFS, isEmptyLocal, parsePrefs, resolvePrefs } from "../src/lib/prefs";

/**
 * Preference sync (#173). Two settings, one wallet, and a rule that must not drift: local always wins
 * on a device that has chosen something, because a person who set light mode here did not ask to be
 * flipped back by a row from six weeks ago.
 */

describe("parsePrefs", () => {
  it("accepts exactly the two settings it stores", () => {
    expect(parsePrefs({ theme: "dark", language: "zh" })).toEqual({ theme: "dark", language: "zh" });
    expect(parsePrefs({ theme: "system", language: "en" })).toEqual(DEFAULT_PREFS);
  });

  it("rejects anything else rather than coercing it", () => {
    for (const bad of [null, undefined, [], "dark", {}, { theme: "dark" }, { theme: "midnight", language: "en" }, { theme: "dark", language: "fr" }, { theme: "dark", language: "en", address: "0x1" }]) {
      const parsed = parsePrefs(bad);
      // the last case is legal input with an extra field — only the two known keys matter
      if (bad && typeof bad === "object" && (bad as Record<string, unknown>).address) {
        expect(parsed).toEqual({ theme: "dark", language: "en" });
      } else {
        expect(parsed).toBeNull();
      }
    }
  });
});

describe("resolvePrefs", () => {
  it("fills an empty device from the wallet", () => {
    expect(resolvePrefs(null, { theme: "light", language: "zh" })).toEqual({ theme: "light", language: "zh" });
    expect(resolvePrefs({}, { theme: "light", language: "zh" })).toEqual({ theme: "light", language: "zh" });
  });

  it("never overwrites a local choice", () => {
    expect(resolvePrefs({ theme: "dark" }, { theme: "light", language: "zh" })).toEqual({ theme: "dark", language: "zh" });
  });

  it("falls back to the default when neither side has anything", () => {
    expect(resolvePrefs(null, null)).toEqual(DEFAULT_PREFS);
  });

  it("ignores values that are not one of ours", () => {
    expect(resolvePrefs({ theme: "midnight" as never }, { theme: "light", language: "en" }).theme).toBe("light");
  });
});

describe("isEmptyLocal", () => {
  it("is true only when the device has chosen nothing", () => {
    expect(isEmptyLocal(null)).toBe(true);
    expect(isEmptyLocal({})).toBe(true);
    expect(isEmptyLocal({ theme: "dark" })).toBe(false);
    expect(isEmptyLocal({ language: "zh" })).toBe(false);
  });
});

/**
 * The claim the privacy page makes: agents are never asked to sign in, and the MCP server does not read
 * preferences. A test, because that sentence is on a public page.
 */
describe("the tool path ignores preferences", () => {
  const root = fileURLToPath(new URL("../../../packages/mcp", import.meta.url));
  const forbidden = /preferences|\/api\/prefs|paystage_siwe/i;

  function walk(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (statSync(full).isDirectory()) walk(full, found);
      else if (/\.(ts|js|json|md)$/.test(entry.name)) found.push(full);
    }
    return found;
  }

  it("never mentions preferences, the prefs endpoint or the SIWE cookie", () => {
    const hits = walk(root).filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });
});
