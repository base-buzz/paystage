import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadPolicy, parsePolicy } from "@paystage/policy";
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  normalizePaymentRequired,
} from "@paystage/preflight";
import type { EvaluateResult } from "@paystage/preflight";
import {
  listOutstandingAuths,
  evaluateOutstandingAuths,
  createRpcClient,
  resolveRpcUrl,
} from "@paystage/auth-watch";
import type { AuthItem, EvaluateAuthResult } from "@paystage/auth-watch";
import {
  evaluateTrade,
  parseTradePolicy,
  fetchMetaAndAssetCtxs,
} from "@paystage/trade-preflight";
import type {
  EvaluateTradeResult,
  Snapshot,
  TradeProposal,
} from "@paystage/trade-preflight";
import {
  evaluateVelocity,
  serializeVelocityResult,
  EvaluateVelocityInputSchema,
} from "@paystage/velocity";

export const TOOL_NAMES = [
  "evaluate_mcp_payment",
  "list_outstanding_auths",
  "evaluate_outstanding_auths",
  "evaluate_hip3_trade",
  "evaluate_velocity",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const DEFAULT_NETWORK = "base";

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

function tokensForNetwork(policy: Policy, network: string): string[] {
  const tokens = (policy as { tokens?: Record<string, string[]> }).tokens;
  return tokens?.[network] ?? [];
}

function spendersForPolicy(policy: Policy): string[] {
  const spenders = (policy as { spenders?: string[] }).spenders;
  return spenders ?? [];
}

const authWatchShape = {
  wallet: z.string(),
  network: z.string().optional(),
  tokens: z.array(z.string()).optional(),
  spenders: z.array(z.string()).optional(),
  policy_path: z.string().optional(),
  policy: z.unknown().optional(),
  eip3009_nonces: z.array(z.string()).optional(),
  rpc_url: z.string().optional(),
};

type AuthWatchArgs = {
  wallet: string;
  network?: string;
  tokens?: string[];
  spenders?: string[];
  policy_path?: string;
  policy?: unknown;
  eip3009_nonces?: string[];
  rpc_url?: string;
};

const tradeProposalShape = z.object({
  dex: z.string(),
  asset: z.string(),
  side: z.enum(["buy", "sell"]),
  size: z.string(),
  leverage: z.number().optional(),
  order_type: z.enum(["limit", "market"]).optional(),
  limit_px: z.string().optional(),
});

type TradeToolArgs = {
  proposal: TradeProposal;
  policy?: unknown;
  policy_path?: string;
  snapshot?: unknown;
};

function registerAllTools(server: McpServer): void {
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

  server.tool(
    "list_outstanding_auths",
    "List outstanding token authorizations for a wallet",
    authWatchShape,
    async (args: AuthWatchArgs) => {
      const policy = await resolvePolicy(args);
      const network = args.network ?? DEFAULT_NETWORK;
      const tokens = args.tokens ?? tokensForNetwork(policy, network);
      const spenders = args.spenders ?? spendersForPolicy(policy);
      const rpcUrl = args.rpc_url ?? resolveRpcUrl(network);
      const rpc = createRpcClient(rpcUrl);
      const items = await listOutstandingAuths({
        wallet: args.wallet,
        network,
        tokens,
        spenders,
        rpc,
        eip3009Nonces: args.eip3009_nonces,
      });
      const serialized = items.map((i: AuthItem) => ({
        ...i,
        amount: i.amount.toString(),
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ items: serialized }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "evaluate_outstanding_auths",
    "List and evaluate outstanding token authorizations against a policy",
    authWatchShape,
    async (args: AuthWatchArgs) => {
      const policy = await resolvePolicy(args);
      const network = args.network ?? DEFAULT_NETWORK;
      const tokens = args.tokens ?? tokensForNetwork(policy, network);
      const spenders = args.spenders ?? spendersForPolicy(policy);
      const rpcUrl = args.rpc_url ?? resolveRpcUrl(network);
      const rpc = createRpcClient(rpcUrl);
      const items = await listOutstandingAuths({
        wallet: args.wallet,
        network,
        tokens,
        spenders,
        rpc,
        eip3009Nonces: args.eip3009_nonces,
      });
      const results = evaluateOutstandingAuths(items, policy);
      const serialized = results.map((r: EvaluateAuthResult) => ({
        item: { ...r.item, amount: r.item.amount.toString() },
        flags: r.flags,
        summary: r.summary,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ results: serialized }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "evaluate_hip3_trade",
    {
      description:
        "Evaluate a Hyperliquid HIP-3 (trade.xyz) order against a TradePolicy before an agent trades. Returns decision allow | review | do_not_trade.",
      inputSchema: {
        proposal: tradeProposalShape,
        policy: z.unknown().optional(),
        policy_path: z.string().optional(),
        snapshot: z.unknown().optional(),
      },
    },
    async (args: TradeToolArgs): Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }> => {
      try {
        const policy = parseTradePolicy(args.policy);
        const snapshot: Snapshot =
          args.snapshot !== undefined
            ? (args.snapshot as Snapshot)
            : await fetchMetaAndAssetCtxs(args.proposal.dex || "xyz");
        const result: EvaluateTradeResult = evaluateTrade(
          args.proposal,
          snapshot,
          policy,
        );
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

  server.registerTool(
    "evaluate_velocity",
    {
      description:
        "Rolling-window rate and spend-pattern check for a proposed payment against recent action history and a policy.velocity config",
      inputSchema: {
        history: EvaluateVelocityInputSchema.shape.history,
        proposed: EvaluateVelocityInputSchema.shape.proposed,
        policy: z.unknown().optional(),
        policy_path: z.string().optional(),
        now_ms: z.number().int().nonnegative().optional(),
      },
    },
    async (input: {
      history?: unknown;
      proposed: unknown;
      policy?: unknown;
      policy_path?: string;
      now_ms?: number;
    }) => {
      try {
        const parsed = EvaluateVelocityInputSchema.parse(input);
        const result = await evaluateVelocity(parsed);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serializeVelocityResult(result), null, 2),
            },
          ],
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
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "paystage",
    version: "0.1.0",
  });
  registerAllTools(server);
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
