import { describe, it, expect } from "vitest";
import { createServer, getToolNames, TOOL_NAMES } from "../src/server.js";

describe("paystage umbrella MCP server", () => {
  // This test asserted five names after nine were registered — the same drift as the hero strip:
  // a list copied rather than derived. It now compares against the constant the server reports.
  it("exports every registered tool name, and getToolNames agrees", () => {
    expect(TOOL_NAMES).toHaveLength(9);
    expect(getToolNames()).toEqual([...TOOL_NAMES]);
    for (const name of [
      "evaluate_mcp_payment",
      "list_outstanding_auths",
      "evaluate_outstanding_auths",
      "evaluate_hip3_trade",
      "evaluate_velocity",
      "verify_receipt",
      "decode_payment_required",
      "validate_policy",
      "evaluate_batch",
    ]) {
      expect(TOOL_NAMES).toContain(name);
    }
  });

  it("createServer constructs a server instance", () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
