import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseTradePolicy } from "./policy.js";
import { fetchMetaAndAssetCtxs } from "./fetch.js";
import { evaluateTrade } from "./evaluate.js";
import type { EvaluateTradeResult, Snapshot, TradeProposal } from "./types.js";

const TradeProposalSchema = z.object({
  dex: z.string(),
  asset: z.string(),
  side: z.enum(["buy", "sell"]),
  size: z.string(),
  leverage: z.number().optional(),
  order_type: z.enum(["limit", "market"]).optional(),
  limit_px: z.string().optional(),
});

const SnapshotSchema = z.object({
  dex: z.string(),
  meta: z.object({ universe: z.array(z.record(z.unknown())) }).passthrough(),
  assetCtxs: z.array(z.record(z.unknown())),
});

export function createServer(): McpServer {
  const server = new McpServer({
    name: "paystage-trade-preflight",
    version: "0.0.0",
  });

  server.registerTool(
    "evaluate_hip3_trade",
    {
      description:
        "Evaluate a Hyperliquid HIP-3 (trade.xyz) order against a TradePolicy before an agent trades. Returns decision allow | review | do_not_trade.",
      inputSchema: {
        proposal: TradeProposalSchema,
        policy: z.unknown(),
        snapshot: SnapshotSchema.optional(),
      },
    },
    async (args: {
      proposal: TradeProposal;
      policy: unknown;
      snapshot?: unknown;
    }): Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }> => {
      try {
        const policy = parseTradePolicy(args.policy);
        const snapshot: Snapshot =
          args.snapshot !== undefined
            ? (SnapshotSchema.parse(args.snapshot) as Snapshot)
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

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
