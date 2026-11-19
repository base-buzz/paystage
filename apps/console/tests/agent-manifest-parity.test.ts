import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAYSTAGE_MANIFEST } from "@/lib/agent-manifest";

/**
 * The manifest must name exactly the tools the server registers.
 *
 * It listed five while the server registered ten, and every agent-facing surface renders from the manifest — so `llms.txt`
 * and `/.well-known/paystage.json` advertised half the product to the only reader that cannot see the rest of the site. The
 * conformance check compared the manifest to itself and stayed green.
 */
describe("agent manifest parity", () => {
  it("names every tool the MCP server registers", () => {
    const source = readFileSync(join(import.meta.dirname, "../../../packages/mcp/src/tools.ts"), "utf8");
    const block = /export const TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(source)?.[1] ?? "";
    const registered = [...block.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);

    expect(registered.length).toBeGreaterThan(0);
    const listed = PAYSTAGE_MANIFEST.tools.map((t) => t.name);
    expect(new Set(listed)).toEqual(new Set(registered));
    expect(listed.length).toBe(registered.length);
  });
});
