import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/server";
import { loadPolicy, parsePolicy } from "@paystage/policy";
import type { Policy } from "@paystage/policy";
import { createMemoryChallengeVerdictStore } from "@paystage/preflight";
import { CURATED_TOOL_NAMES, registerAllTools, SERVER_CAPABILITIES, TOOL_NAMES, type ToolName } from "./tools.js";

/**
 * Report the real package version. This was hardcoded as "0.3.0" and stayed there two releases,
 * so every client logging serverInfo was told the wrong version.
 */
const SERVER_VERSION = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

export { CURATED_TOOL_NAMES, TOOL_NAMES };
export type { ToolName };

/**
 * The #444 repeat store for the stdio server.
 *
 * Per process and bounded (TTL + entry cap). The salt is generated here rather than committed;
 * nothing durable writes these keys today, and a host that adds one must supply a deployment salt
 * instead of this value.
 */
const challengeSalt = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
})();
const challengeStore = createMemoryChallengeVerdictStore();

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
  registerAllTools(server, {
    resolvePolicy,
    version: SERVER_VERSION,
    // #444: the stdio process is long-lived, so the bounded in-memory store is a real store here,
    // not a placeholder. A restart forgets, and a retry after the TTL is a new decision — the same
    // boundary the payment-identifier cache documents. The salt is per process, never in the repo.
    challengeStore,
    challengeSalt,
  });
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
