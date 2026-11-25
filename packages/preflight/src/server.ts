import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { loadPolicy, parsePolicy } from "@paystage/policy";
import type { Policy } from "@paystage/policy";
import { normalizePaymentRequired } from "./normalize.js";
import type { EvaluateResult } from "./evaluate.js";
import {
  createMemoryChallengeVerdictStore,
  evaluateWithChallengeIdempotency,
} from "./challenge-idempotency.js";
import { evaluateToolInput } from "./tool-schema.js";

/**
 * The stdio server is a long-running process, so it is a legitimate owner of the #444 repeat store.
 *
 * In memory and per process, like the payment-identifier cache: a restart forgets and a rebuy after
 * the TTL is a new decision. The salt is generated per process rather than committed, so the keys
 * on disk (none here) or in a future durable store never match a value in the repo. A future
 * durable host substitutes its own `ChallengeVerdictStore` and deployment salt.
 */
const challengeSalt = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
})();
const challengeStore = createMemoryChallengeVerdictStore();

export function createServer(): McpServer {
  const server = new McpServer({
    name: "paystage-preflight",
    version: "0.2.0",
  });

  server.registerTool(
    "evaluate_mcp_payment",
    {
      description:
        "Evaluate an x402 PaymentRequired payload against a PayStage spending policy before paying",
      // Hand-written Standard Schema: the input contract is a public surface, and #181 removed
      // the last zod import from this package. See `tool-schema.ts`.
      inputSchema: evaluateToolInput,
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
        const result: EvaluateResult = await evaluateWithChallengeIdempotency(pr, policy, {
          challengeStore,
          challengeSalt,
        });
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
