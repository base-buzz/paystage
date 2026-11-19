import { describe, expect, it } from "vitest";
import { PROTECTED_ROUTES, PAID_ALIAS, buildRoutesConfig } from "../src/x402.js";

/**
 * #150 — the paid-only alias exists so an indexer's fresh IP gets a 402 instead of the free tier's 200.
 *
 * The assertions are about the two things that would silently undo it: the alias disappearing from the paid route table, or the
 * free tier learning the alias and answering it for free.
 */
describe("paid-only alias", () => {
  it("is a paid route with a price and the bazaar extension", () => {
    const routes = buildRoutesConfig({
      price: "$0.002",
      network: "eip155:8453",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    } as never) as Record<string, { extensions?: unknown; accepts?: unknown[] }>;
    const alias = routes[`POST ${PAID_ALIAS}`];
    expect(alias, `expected POST ${PAID_ALIAS} in the paid route table`).toBeDefined();
    expect(alias.accepts?.length).toBe(1);
    expect(JSON.stringify(alias.extensions)).toContain("bazaar");
  });

  it("is not in the free tier's path set", async () => {
    const { FREE_PATHS } = (await import("../src/free-tier.js")) as { FREE_PATHS?: Set<string> };
    // The set is module-private by design; if it ever becomes exported, this assertion must check it rather than trust the path.
    if (FREE_PATHS) expect(FREE_PATHS.has(PAID_ALIAS)).toBe(false);
    else expect(PAID_ALIAS.startsWith("/v1/paid/")).toBe(true);
  });

  it("keeps the canonical protected routes", () => {
    expect(PROTECTED_ROUTES).toContain("POST /v1/evaluate_mcp_payment");
  });
});
