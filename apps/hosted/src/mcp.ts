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
import { z } from "zod";
import { evaluatePayment, normalizePaymentRequired } from "@paystage/preflight";
import { parsePolicy } from "@paystage/policy";

export const MCP_PATH = "/mcp";

const SERVICE_VERSION = "2026.11.12";

function buildServer(): McpServer {
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
      const result = evaluatePayment(
        normalizePaymentRequired(payment_required as never),
        parsePolicy(policy as never) as never,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  return server;
}

/** Web-standard handler: one call per HTTP request, no state between calls. */
export function mcpHandler(): { fetch: (request: Request) => Promise<Response> } {
  return createMcpHandler(() => buildServer());
}
