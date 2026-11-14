
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { parsePolicy } from "@paystage/policy";
import type { Policy } from "@paystage/policy";
import { evaluatePayment, normalizePaymentRequired } from "@paystage/preflight";
import type { EvaluateResult } from "@paystage/preflight";
import { verifyReceipt } from "./verify.js";
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
  "verify_receipt",
  "decode_payment_required",
  "validate_policy",
  "evaluate_batch",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const DEFAULT_NETWORK = "base";

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

export interface ToolDeps {
  /**
   * Resolve a policy from a tool call. The stdio server reads a file; the hosted Worker has no
   * filesystem, so it refuses `policy_path` and requires an inline policy.
   */
  resolvePolicy: (input: { policy?: unknown; policy_path?: string }) => Promise<Policy>;
  /** Reported in `serverInfo`; the Worker and the package version them separately. */
  version: string;
}

export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "evaluate_mcp_payment",
    {
      description:
        "Evaluate an x402 PaymentRequired payload against a PayStage spending policy before paying",
      inputSchema: z.object({
        payment_required: z.unknown(),
        policy_path: z.string().optional(),
        policy: z.unknown().optional(),
        agent_id: z
          .string()
          .optional()
          .describe("Which agent is asking. Required to reach per-agent budgets in policy.agents."),
      }),
    },
    async (input: {
      payment_required: unknown;
      policy_path?: string;
      policy?: unknown;
      agent_id?: string;
    }): Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }> => {
      try {
        const policy = await deps.resolvePolicy(input);
        const pr = normalizePaymentRequired(input.payment_required);
        const result: EvaluateResult = evaluatePayment(
          pr,
          policy,
          input.agent_id !== undefined ? { agentId: input.agent_id } : {},
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
    "list_outstanding_auths",
    {
      description: "List outstanding token authorizations for a wallet",
      inputSchema: z.object(authWatchShape),
    },
    async (args: AuthWatchArgs) => {
      const policy = await deps.resolvePolicy(args);
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

  server.registerTool(
    "evaluate_outstanding_auths",
    {
      description:
        "List and evaluate outstanding token authorizations against a policy",
      inputSchema: z.object(authWatchShape),
    },
    async (args: AuthWatchArgs) => {
      const policy = await deps.resolvePolicy(args);
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
      inputSchema: z.object({
        proposal: tradeProposalShape,
        policy: z.unknown().optional(),
        policy_path: z.string().optional(),
        snapshot: z.unknown().optional(),
      }),
    },
    async (
      args: TradeToolArgs,
    ): Promise<{
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
      inputSchema: z.object({
        history: EvaluateVelocityInputSchema.shape.history,
        proposed: EvaluateVelocityInputSchema.shape.proposed,
        policy: z.unknown().optional(),
        policy_path: z.string().optional(),
        now_ms: z.number().int().nonnegative().optional(),
      }),
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
  // ---------------------------------------------------------------------------------------------
  // Four more tools, added 2026-11-14. Each one reuses code that already shipped as a library or a
  // CLI call: nothing here is new logic, it is the same evaluation reachable from an agent.
  // ---------------------------------------------------------------------------------------------

  server.registerTool(
    "verify_receipt",
    {
      description:
        "Verify a PayStage receipt against the published signing key. Returns the verdict it attests to, or why it cannot be trusted.",
      inputSchema: z.object({
        receipt: z.unknown().describe("The receipt object as issued"),
        key_url: z.string().url().optional().describe("Override the published key location"),
      }),
    },
    async ({ receipt, key_url }: { receipt: unknown; key_url?: string }) => {
      try {
        const verdict = await verifyReceipt(receipt as never, key_url ? { keyUrl: key_url } : {});
        return { content: [{ type: "text" as const, text: JSON.stringify(verdict, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    },
  );

  server.registerTool(
    "decode_payment_required",
    {
      description:
        "Decode a base64 `payment-required` header from a 402 response into the JSON challenge, so an agent can inspect it before deciding anything.",
      inputSchema: z.object({
        header: z.string().min(1).describe("The raw base64 value of the payment-required header"),
      }),
    },
    async ({ header }: { header: string }) => {
      // Inline rather than importing @paystage/x402-guard: this is four lines and a dependency for
      // four lines is a supply-chain cost paid by every user of the umbrella.
      let decoded: string;
      try {
        decoded = typeof atob === "function" ? atob(header) : Buffer.from(header, "base64").toString("utf8");
      } catch {
        return { isError: true, content: [{ type: "text" as const, text: "Error: header is not valid base64" }] };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoded);
      } catch {
        return { isError: true, content: [{ type: "text" as const, text: "Error: decoded header is not JSON" }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }] };
    },
  );

  server.registerTool(
    "validate_policy",
    {
      description:
        "Check a policy document without evaluating a payment. Returns the exact validation error when it is wrong, which is the question behind most support requests.",
      inputSchema: z.object({ policy: z.unknown() }),
    },
    async ({ policy }: { policy: unknown }) => {
      try {
        const parsed = parsePolicy(policy as never);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ valid: true, version: (parsed as { version?: number }).version ?? null }, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ valid: false, error: message }, null, 2) }],
        };
      }
    },
  );

  server.registerTool(
    "evaluate_batch",
    {
      description:
        "Evaluate several payment challenges against one policy in a single call. Returns one verdict per input, in order, so an agent settling a batch decides once per payment and can stop at the first refusal.",
      inputSchema: z.object({
        payments: z.array(z.unknown()).min(1).max(50),
        policy: z.unknown(),
      }),
    },
    async ({ payments, policy }: { payments: unknown[]; policy: unknown }) => {
      const parsedPolicy = parsePolicy(policy as never);
      const results = payments.map((payment) => {
        try {
          const normalised = normalizePaymentRequired(payment as never);
          return evaluatePayment(normalised as never, parsedPolicy as never);
        } catch (error) {
          return {
            decision: "do_not_pay" as const,
            reasons: [`could not evaluate: ${error instanceof Error ? error.message : String(error)}`],
          };
        }
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ results }, null, 2) }] };
    },
  );

}

