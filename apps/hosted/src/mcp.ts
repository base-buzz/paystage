/**
 * PayStage as a remote MCP server.
 *
 * The package on npm is stdio-only (`npx paystage-mcp`), which means every directory,
 * gateway and hosted client — Arcade, Cursor's remote servers, Claude's connectors — sees
 * no URL to connect to. A directory listing without a URL is a business card with no phone
 * number.
 *
 * This mounts the same five tools over Streamable HTTP at `/mcp`, using the SDK's
 * web-standard handler so it runs in the Worker with no Node APIs.
 *
 * Tools are thin wrappers over the same evaluator the REST route uses: one implementation of
 * the decision, two transports.
 */

import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { recordEvent, sourceFromHeaders, type TelemetrySource } from "./telemetry.js";
import { z } from "zod";
import { evaluatePayment, normalizePaymentRequired } from "@paystage/preflight";
import { parsePolicy } from "@paystage/policy";

export const MCP_PATH = "/mcp";

const SERVICE_VERSION = "2026.11.12";

/**
 * Telemetry for the MCP path.
 *
 * The REST route records every call; this one recorded nothing at all until 2026-11-14, so a
 * ChatGPT session could return a perfect `do_not_pay` verdict and the metrics would show zero — the
 * busiest surface we have was invisible. A real agent call and a quiet day were the same number.
 */
function buildServer(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }, source: TelemetrySource): McpServer {
  const server = new McpServer({ name: "paystage", version: SERVICE_VERSION });

  server.registerTool(
    "evaluate_mcp_payment",
    {
      description:
        "Decide whether an x402 payment should be signed, against a policy. Returns pay, review or do_not_pay with the rule that fired.",
      inputSchema: {
        payment_required: z.unknown().describe("The x402 PaymentRequired object from the 402 challenge"),
        policy: z.unknown().describe("The policy document (version 1)"),
      },
    },
    async ({ payment_required, policy }: { payment_required: unknown; policy: unknown }) => {
      const started = Date.now();
      const result = evaluatePayment(
        normalizePaymentRequired(payment_required as never),
        parsePolicy(policy as never) as never,
      );

      // No signature reaches this point, so there is no payer and no tx_hash to record — the
      // verdict is the whole event. `waitUntil` is optional under MCP, so a failed write must not
      // change the response the client gets.
      try {
        await recordEvent(
          { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY },
          {
            source,
            tool: "evaluate_mcp_payment",
            decision: result.decision,
            reason_codes: (result.reasons ?? []).map(String),
            network: String((payment_required as { accepts?: Array<{ network?: string }> })?.accepts?.[0]?.network ?? "unknown"),
            latency_ms: Date.now() - started,
          },
        );
      } catch {
        // A telemetry failure must never turn a successful evaluation into an error for the agent.
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  return server;
}

/** Web-standard handler: one call per HTTP request, no state between calls. */
export function mcpHandler(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): { fetch: (request: Request) => Promise<Response> } {
  return createMcpHandler((ctx) => {
    // `requestInfo` is the inbound Request; headers decide whether this is a real agent or our own
    // probe, exactly as the REST route does.
    const req = ctx?.requestInfo;
    const source = req ? sourceFromHeaders({ header: (name: string) => req.headers.get(name) ?? undefined }) : "real";
    return buildServer(env, source);
  });
}
