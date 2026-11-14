/**
 * PayStage as a remote MCP server — the same nine tools the npm package serves.
 *
 * It used to mount ONE tool while the site said nine, so every URL-based channel (Arcade, the MCP
 * registry's remote entry, the Docker catalogue, ChatGPT) reached a narrower surface than the page
 * promised. Two transports, one registration module: the only way they cannot drift is if there is
 * only one list.
 */
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { registerAllTools, SERVER_CAPABILITIES } from "@paystage/mcp/tools";
import { parsePolicy } from "@paystage/policy";
import { recordEvent, sourceFromHeaders, type TelemetrySource } from "./telemetry.js";

export const MCP_PATH = "/mcp";
const SERVICE_VERSION = "2026.11.14";

type Env = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };

function buildServer(env: Env, source: TelemetrySource): McpServer {
  const server = new McpServer(
    { name: "paystage", version: SERVICE_VERSION },
    { capabilities: SERVER_CAPABILITIES },
  );

  registerAllTools(server, {
    // No filesystem in a Worker: a caller must send the policy inline. Refusing `policy_path` with a
    // sentence beats a stack trace from a missing module.
    resolvePolicy: async (input) => {
      if (input.policy === undefined) {
        throw new Error(
          "policy is required on the hosted endpoint — send the policy object; `policy_path` only works in the stdio package",
        );
      }
      return parsePolicy(input.policy as never);
    },
    version: SERVICE_VERSION,
  });

  // Telemetry: the MCP path recorded nothing until 2026-11-14, so a real agent call and a quiet day
  // were the same number. The tool results are not parsed here; the decision is read from the text
  // the tool produced, which keeps this wrapper independent of the registration module.
  const original = server.registerTool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: unknown, handler: any) =>
    original(name as never, config as never, (async (...args: unknown[]) => {
      const started = Date.now();
      const result = await handler(...args);
      try {
        const text = result?.content?.[0]?.text ?? "";
        let decision = "unknown";
        try {
          const parsed = JSON.parse(text);
          decision = String(parsed?.decision ?? parsed?.valid ?? parsed?.ok ?? "unknown");
        } catch {}
        await recordEvent(
          { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY },
          {
            source,
            tool: name,
            decision,
            reason_codes: [],
            network: "eip155:8453",
            latency_ms: Date.now() - started,
          },
        );
      } catch {
        // A telemetry failure must never turn a successful tool call into an error for the agent.
      }
      return result;
    }) as never);

  return server;
}

export function mcpHandler(env: Env): { fetch: (request: Request) => Promise<Response> } {
  return createMcpHandler((ctx) => {
    const req = ctx?.requestInfo;
    const source = req
      ? sourceFromHeaders({ header: (name: string) => req.headers.get(name) ?? undefined })
      : "real";
    return buildServer(env, source);
  });
}
