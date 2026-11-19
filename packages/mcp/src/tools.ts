
import { McpServer, type ServerCapabilities } from "@modelcontextprotocol/server";
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
  "request_testnet_funds",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * `@paystage/mcp/<version>`, sent on every outbound call (#52).
 *
 * Derived from the package manifest at build time would be better; a constant beside the version field is one edit and
 * `scripts/check-client-id.mjs` fails CI when the two disagree, which is the guard that makes a constant safe.
 */
export const CLIENT_PACKAGE = "@paystage/mcp";
export const CLIENT_ID = `${CLIENT_PACKAGE}/0.8.15`;

const DEFAULT_NETWORK = "base";

/**
 * The server exposes tools only, but it must answer `resources/list` and `prompts/list` with an
 * empty result rather than `-32601 Method not found`: Anthropic's and Cursor's MCP checks treat a
 * declared-but-unimplemented capability as a bug, and a client that probes either list gets a hard
 * error instead of "none". Declaring the capabilities is what makes the SDK serve the empty lists
 * (see `ServerOptions.capabilities`); no resource or prompt is registered.
 *
 * Shared by the stdio server and the hosted Worker so both surfaces answer the same way.
 */
export const SERVER_CAPABILITIES: ServerCapabilities = { resources: {}, prompts: {} };

function tokensForNetwork(policy: Policy, network: string): string[] {
  const tokens = (policy as { tokens?: Record<string, string[]> }).tokens;
  return tokens?.[network] ?? [];
}

function spendersForPolicy(policy: Policy): string[] {
  const spenders = (policy as { spenders?: string[] }).spenders;
  return spenders ?? [];
}

/**
 * A raw shape, not a `ZodObject`.
 *
 * `inputSchema: z.object(authWatchShape)` looked equivalent and compiled against the locally installed SDK, but a fresh
 * install resolves stricter types: `registerTool` wants `Record<string, ZodType>` and infers the callback's argument
 * from it. The wrapper broke that inference, and the failure only appeared on a clean build — which would have broken
 * the *next* release rather than the published one.
 */
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
  /**
   * The published key, when the host already holds it.
   *
   * A Worker that serves `verify_receipt` cannot fetch its own `/v1/public/receipt-key.json`: the
   * subrequest to its own origin came back 522/523, so a genuine signed receipt reported
   * `unverifiable` on the live endpoint while the same check passed locally. Passing the key in
   * removes the network from the one path that is supposed to be an independent check.
   */
  resolveReceiptKey?: () => Promise<Record<string, unknown> | null>;
}

export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "evaluate_mcp_payment",
    {
      description:
        "verify the recipient. Call this BEFORE signing any x402 payment. Verdict is pay | review | do_not_pay, each with stable reason codes (e.g. 'amount 1.00 USDC exceeds max_amount 0.05 USDC'). Fail-closed by design: do not invent authority — when policy, identity, cost or evidence is missing the answer is a refusal or a review, never a pay. Returns the decision plus a signed receipt you can verify offline with verify_receipt. Read-only: holds no keys, never signs, never moves funds. A refusal costs nothing. This tool evaluates locally, so it makes no network calls and returns no seller reputation; the hosted HTTP API adds `seller_reputation` (domain and certificate age) because it can reach the network.",
      annotations: {
        title: "Evaluate an x402 payment (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        payment_required: z.unknown(),
        policy_path: z.string().optional(),
        policy: z.unknown().optional(),
        agent_id: z
          .string()
          .optional()
          .describe("Which agent is asking. Required to reach per-agent budgets in policy.agents."),
        payment_identifier: z
          .string()
          .max(128)
          .optional()
          .describe(
            "The x402 payment-identifier for this challenge, if the seller or client supplies one. Passing the same value on a retry turns the second verdict into `review` instead of a second `pay`, because a retried preflight is not a second approval.",
          ),
      },
    },
    async (input: {
      payment_required: unknown;
      policy_path?: string;
      policy?: unknown;
      agent_id?: string;
      payment_identifier?: string;
    }) => {
      try {
        const policy = await deps.resolvePolicy(input);
        const pr = normalizePaymentRequired(input.payment_required);
        const result: EvaluateResult = evaluatePayment(pr, policy, {
          ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
          ...(input.payment_identifier !== undefined ? { paymentIdentifier: input.payment_identifier } : {}),
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error: ${message}` }],
        };
      }
    },
  );

  server.registerTool(
    "list_outstanding_auths",
    {
      description:
        "spending limits. Call this when auditing what an agent could still spend without a new signature — ERC-20 allowances, Permit2 and EIP-3009 authorisations. Returns each authorisation with spender, amount and expiry. Read-only and needs only a public RPC; no key, no funds moved. Use it after an incident to see what remains exposed, not to revoke anything (this tool cannot revoke).",
      annotations: {
        title: "List outstanding token authorizations (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: authWatchShape,
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
            type: "text" as const,
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
        "spending limits. Call this when an agent already holds authorisations and you need to know which are dangerous. Verdict is pay | review | do_not_pay per authorisation, with reason codes naming the rule that fired (unlimited allowance, expiry already passed, spender not on the allow-list). Returns per-authorisation decisions plus a summary action. Read-only: never revokes, never signs. Revocation is a transaction you send yourself.",
      annotations: {
        title: "Evaluate outstanding token authorizations (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: authWatchShape,
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
            type: "text" as const,
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
        "transaction scope. Call this BEFORE an agent places a HIP-3 / trade.xyz order. Verdict is allow | review | do_not_trade, with the rule that fired (notional above cap, market not allowed, leverage too high). Returns the decision and a one-line reason. Local policy only: this is not financial advice, holds no keys, and cannot place or cancel an order. Prices come from a read-only market query.",
      annotations: {
        title: "Evaluate a HIP-3 trade (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        proposal: tradeProposalShape,
        policy: z.unknown().optional(),
        policy_path: z.string().optional(),
        snapshot: z.unknown().optional(),
      },
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
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error: ${message}` }],
        };
      }
    },
  );

  server.registerTool(
    "evaluate_velocity",
    {
      description:
        "transparent risk assessments. Call this when an agent is about to make its Nth payment and you need to know whether the rate itself is the risk. Verdict is pay | review | do_not_pay over a rolling window (per-hour and per-day spend, count of payees). Returns the decision plus which window was breached. Read-only: it reads the history you pass in, holds no keys, and calls no external service.",
      annotations: {
        title: "Evaluate payment velocity (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
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
              type: "text" as const,
              text: JSON.stringify(serializeVelocityResult(result), null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error: ${message}` }],
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
        "verify the recipient. Call this when you have a receipt and want to know whether it is genuine, without trusting the server that issued it. Returns VALID with the verdict it attests to, INVALID if the payload was altered, or UNVERIFIABLE when the key cannot be fetched — and UNVERIFIABLE is a refusal, not a pass. Needs only the receipt JSON and a network connection; no account, no shared secret. Fetches the signing key from a published URL you can pin with key_url.",
      annotations: {
        title: "Verify a receipt against the published key (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        receipt: z.unknown().describe("The receipt object as issued"),
        key_url: z.string().url().optional().describe("Override the published key location"),
      },
    },
    async ({ receipt, key_url }: { receipt: unknown; key_url?: string }) => {
      try {
        // Prefer a key the host already holds; an explicit key_url still wins, so a caller can check
        // a receipt from a different deployment against that deployment's published key.
        const injected = key_url === undefined && deps.resolveReceiptKey
          ? await deps.resolveReceiptKey()
          : null;
        const verdict = await verifyReceipt(
          receipt as never,
          key_url ? { keyUrl: key_url } : injected ? { jwk: injected as never } : {},
        );
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
        "verify the recipient. Call this first when a 402 response arrives and you cannot read the payment-required header. Returns the decoded x402 v2 challenge: scheme, network, asset, atomic amount, payee, resource and timeout. Pure decoding: no network call, no signature, no verdict — use evaluate_mcp_payment when you want a decision. Fails closed with a named error if the header is malformed or not base64.",
      annotations: {
        title: "Decode a payment-required header (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        header: z.string().min(1).describe("The raw base64 value of the payment-required header"),
      },
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
        "spending limits. Call this before wiring a policy into anything: a policy that fails validation makes every evaluation refuse, which looks like a product bug and is not one. Returns valid: true, or the exact field and message that is wrong. No payment needed, no network call, no key. Use it in CI on the policy file your agent ships with.",
      annotations: {
        title: "Validate a spending policy (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: { policy: z.unknown() },
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
    "request_testnet_funds",
    {
      description:
        "test funds. Call this when you need Base Sepolia USDC to exercise the paid path end to end — one drip of 0.5 USDC per address per 24 hours, and the refusal tells you when it resets rather than just failing. Reads a public faucet: no key needed, no account, and it can only ever send testnet USDC. Use a throwaway address for anything automated; the cap is per address, so a script that generates a new address per call is not clever, it is why faucets get closed.",
      annotations: {
        title: "Request testnet funds (writes a testnet tx, never touches mainnet)",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "a 0x-prefixed 20-byte address"),
        faucetUrl: z.string().url().optional(),
      },
    },
    async ({ address, faucetUrl }: { address: string; faucetUrl?: string }) => {
      const url = faucetUrl ?? "https://sepolia.api.paystage.xyz/faucet";
      try {
        const res = await fetch(url, {
          method: "POST",
          // The client identifies its own build so calls can be attributed to an installed version (#52). It is the
          // package version, not the caller: no IP, no id, nothing that survives the request.
          headers: { "content-type": "application/json", "x-paystage-client": CLIENT_ID },
          body: JSON.stringify({ address }),
          signal: AbortSignal.timeout(60_000),
        });
        const body = (await res.json()) as Record<string, unknown>;
        // A refusal is a result, not an error: an agent needs the reset time to decide what to do next, and an
        // exception would throw that away.
        return { content: [{ type: "text" as const, text: JSON.stringify({ status: res.status, ...body }, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "faucet unreachable", detail: String(error).slice(0, 200) }, null, 2),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "evaluate_batch",
    {
      description:
        "transaction scope. Call this when an agent might pay several times in one turn and you want one policy decision covering all of them. Verdict is pay | review | do_not_pay per item, in input order, with reason codes — so the agent can stop at the first refusal rather than discovering it after three payments. Read-only, holds no keys, never signs. Cheaper and more consistent than calling evaluate_mcp_payment in a loop: same policy, one round trip.",
      annotations: {
        title: "Evaluate a batch of x402 payments (read-only, never signs)",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        payments: z.array(z.unknown()).min(1).max(50),
        policy: z.unknown(),
      },
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

