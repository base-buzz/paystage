import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/server";
import { loadPolicy, parsePolicy } from "@paystage/policy";
import type { Policy } from "@paystage/policy";
import { registerAllTools, SERVER_CAPABILITIES, TOOL_NAMES, type ToolName } from "./tools.js";

/**
 * Report the real package version. This was hardcoded as "0.3.0" and stayed there two releases,
 * so every client logging serverInfo was told the wrong version.
 */
const SERVER_VERSION = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

export { TOOL_NAMES };
export type { ToolName };

/** The stdio transport resolves a policy from a path; the Worker never can. */
async function resolvePolicy(input: { policy?: unknown; policy_path?: string }): Promise<Policy> {
  if (input.policy !== undefined) return parsePolicy(input.policy);
  const path = input.policy_path ?? process.env.PAYSTAGE_POLICY_PATH ?? "./policy.json";
  return await loadPolicy(path);
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "paystage", version: SERVER_VERSION },
    { capabilities: SERVER_CAPABILITIES },
  );
  registerAllTools(server, { resolvePolicy, version: SERVER_VERSION });
  return server;
}

export function getToolNames(): string[] {
  return [...TOOL_NAMES];
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
