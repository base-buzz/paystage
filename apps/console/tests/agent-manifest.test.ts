import { describe, expect, it } from "vitest";
import { PACKAGE_VERSIONS, PAYSTAGE_MANIFEST } from "@/lib/agent-manifest";

import authWatchPkg from "../../../packages/auth-watch/package.json";
import mcpPkg from "../../../packages/mcp/package.json";
import policyPkg from "../../../packages/policy/package.json";
import preflightPkg from "../../../packages/preflight/package.json";
import tradePreflightPkg from "../../../packages/trade-preflight/package.json";
import velocityPkg from "../../../packages/velocity/package.json";

/**
 * The machine-readable surface must not drift from what is actually shipped.
 * Versions are imported in `agent-manifest.ts`; this guards the manifest's shape
 * and catches a package added to the workspace without a manifest entry.
 */
describe("agent manifest", () => {
  it("reports the workspace versions", () => {
    expect(PACKAGE_VERSIONS["@paystage/mcp"]).toBe(mcpPkg.version);
    expect(PACKAGE_VERSIONS["@paystage/policy"]).toBe(policyPkg.version);
    expect(PACKAGE_VERSIONS["@paystage/preflight"]).toBe(preflightPkg.version);
    expect(PACKAGE_VERSIONS["@paystage/auth-watch"]).toBe(authWatchPkg.version);
    expect(PACKAGE_VERSIONS["@paystage/trade-preflight"]).toBe(tradePreflightPkg.version);
    expect(PACKAGE_VERSIONS["@paystage/velocity"]).toBe(velocityPkg.version);
  });

  it("states the safety facts the site claims", () => {
    expect(PAYSTAGE_MANIFEST.holds_keys).toBe(false);
    expect(PAYSTAGE_MANIFEST.signs_transactions).toBe(false);
    expect(PAYSTAGE_MANIFEST.shell).toBe(false);
    expect(PAYSTAGE_MANIFEST.telemetry).toBe(false);
    expect(PAYSTAGE_MANIFEST.license).toBe("MIT");
  });

  it("exposes only the documented environment variables", () => {
    expect([...PAYSTAGE_MANIFEST.environment_variables]).toEqual([
      "PAYSTAGE_POLICY_PATH",
      "PAYSTAGE_RPC_URL",
    ]);
  });

  it("lists every tool with a package that exists", () => {
    for (const tool of PAYSTAGE_MANIFEST.tools) {
      expect(PACKAGE_VERSIONS[tool.package], tool.package).toBeDefined();
      expect(tool.name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("keeps the two verdict vocabularies separate", () => {
    const payment = PAYSTAGE_MANIFEST.tools.find((t) => t.name === "evaluate_mcp_payment");
    const trade = PAYSTAGE_MANIFEST.tools.find((t) => t.name === "evaluate_hip3_trade");
    expect(payment?.decisions).toEqual(["pay", "review", "do_not_pay"]);
    expect(trade?.decisions).toEqual(["allow", "review", "do_not_trade"]);
  });

  it("points socials at https URLs a human can load", () => {
    expect(PAYSTAGE_MANIFEST.socials.length).toBeGreaterThan(0);
    for (const social of PAYSTAGE_MANIFEST.socials) {
      expect(social.url).toMatch(/^https:\/\/[\w.-]+\/[\w.@/-]+$/);
      expect(social.label).not.toHaveLength(0);
    }
    expect(PAYSTAGE_MANIFEST.socials.map((s) => s.label)).toContain("X");
  });
});
