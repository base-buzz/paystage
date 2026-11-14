import { describe, it, expect } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, getToolNames, TOOL_NAMES } from "../src/server.js";

/**
 * Call one JSON-RPC method over the same HTTP handler the hosted Worker uses. Going through the
 * handler rather than reaching into McpServer's private registries is what proves the annotations
 * and empty lists survive serialization.
 */
async function rpc(method: string): Promise<Record<string, unknown>> {
  const handler = createMcpHandler(() => createServer());
  const res = await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
    }),
  );
  const text = await res.text();
  const data = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data: "));
  if (!data) throw new Error(`no SSE data frame in response: ${text}`);
  const body = JSON.parse(data.slice("data: ".length)) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  if (body.error) throw new Error(`${method} failed: ${body.error.code} ${body.error.message}`);
  return body.result ?? {};
}

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

  it("serializes all four required annotations on every tool, read-only for all nine", async () => {
    const { tools } = (await rpc("tools/list")) as {
      tools: Array<{
        name: string;
        annotations?: Record<string, unknown>;
      }>;
    };
    expect(tools).toHaveLength(9);

    // Accuracy, not a blanket default: the five tools that touch the network are marked open-world,
    // the four that only evaluate supplied input are not.
    const openWorld = {
      evaluate_mcp_payment: false,
      evaluate_batch: false,
      validate_policy: false,
      decode_payment_required: false,
      evaluate_velocity: false,
      verify_receipt: true,
      list_outstanding_auths: true,
      evaluate_outstanding_auths: true,
      evaluate_hip3_trade: true,
    };

    for (const tool of tools) {
      const annotations = tool.annotations;
      expect(annotations, `${tool.name} has no annotations`).toBeDefined();
      expect(annotations!.title, `${tool.name} title`).toEqual(expect.any(String));
      expect((annotations!.title as string).length).toBeGreaterThan(0);

      // The product's central claim: no tool signs or writes. This is asserted, not assumed — a
      // tool that could write would be a product change, not a metadata tweak.
      expect(annotations!.readOnlyHint, `${tool.name} readOnlyHint`).toBe(true);
      expect(annotations!.destructiveHint, `${tool.name} destructiveHint`).toBe(false);
      expect(annotations!.openWorldHint, `${tool.name} openWorldHint`).toBe(
        openWorld[tool.name as keyof typeof openWorld],
      );
      expect(Object.keys(openWorld)).toContain(tool.name);
    }
  });

  it("answers resources/list and prompts/list with empty arrays, not Method not found", async () => {
    const resources = (await rpc("resources/list")) as { resources?: unknown[] };
    expect(resources.resources).toEqual([]);

    const prompts = (await rpc("prompts/list")) as { prompts?: unknown[] };
    expect(prompts.prompts).toEqual([]);
  });
});
