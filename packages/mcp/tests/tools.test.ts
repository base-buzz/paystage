import { describe, it, expect } from "vitest";
import { createServer, getToolNames, TOOL_NAMES } from "../src/server.js";

describe("paystage umbrella MCP server", () => {
  it("exports the expected tool names", () => {
    expect(TOOL_NAMES).toEqual([
      "evaluate_mcp_payment",
      "list_outstanding_auths",
      "evaluate_outstanding_auths",
    ]);
  });

  it("getToolNames returns exactly the three registered tools", () => {
    const names = getToolNames();
    expect(names).toHaveLength(3);
    expect(new Set(names)).toEqual(
      new Set([
        "evaluate_mcp_payment",
        "list_outstanding_auths",
        "evaluate_outstanding_auths",
      ]),
    );
  });

  it("createServer constructs a server instance", () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
