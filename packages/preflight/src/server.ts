import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPolicy, parsePolicy } from "@paystage/policy";
import type { Policy } from "@paystage/policy";
import { normalizePaymentRequired } from "./normalize.js";
import { evaluatePayment } from "./evaluate.js";
import type { EvaluateResult } from "./evaluate.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "paystage-preflight",
    version: "0.1.0",
  });

  server.registerTool(
    "evaluate_mcp_payment",
    {
      description:
        "Evaluate an x402 PaymentRequired payload against a PayStage spending policy before paying",
      inputSchema: {
        payment_required: z.unknown(),
        policy_path: z.string().optional(),
        policy: z.unknown().optional(),
      },
    },
    async (input: {
      payment_required: unknown;
      policy_path?: string;
      policy?: unknown;
    }): Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }> => {
      try {
        const policy = await resolvePolicy(input);
        const pr = normalizePaymentRequired(input.payment_required);
        const result: EvaluateResult = evaluatePayment(pr, policy);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${message}` }],
        };
      }
    },
  );

  return server;
}

async function resolvePolicy(input: {
  policy?: unknown;
  policy_path?: string;
}): Promise<Policy> {
  if (input.policy !== undefined) {
    return parsePolicy(input.policy);
  }
  const path =
    input.policy_path ?? process.env.PAYSTAGE_POLICY_PATH ?? "./policy.json";
  return await loadPolicy(path);
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
