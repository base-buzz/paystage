import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadPolicy, parsePolicy } from "@paystage/policy";
import type { Policy } from "@paystage/policy";
import { evaluateOutstandingAuths } from "./evaluate.js";
import { listOutstandingAuths } from "./scan.js";
import { createRpcClient, resolveRpcUrl } from "./rpc.js";
import { USDC_BASE, USDC_SEPOLIA } from "./constants.js";

const DEFAULT_NETWORK = "eip155:8453";

function tokensForNetwork(policy: Policy, network: string): string[] {
  const assets = policy.allowed_assets ?? [];
  const out: string[] = [];
  for (const asset of assets) {
    if (typeof asset === "string") {
      out.push(asset);
    } else if (asset && typeof asset === "object") {
      const a = asset as { address?: string; network?: string };
      if (a.address && (!a.network || a.network === network)) {
        out.push(a.address);
      }
    }
  }
  if (out.length === 0) {
    if (network === "eip155:8453") out.push(USDC_BASE);
    else if (network === "eip155:84532") out.push(USDC_SEPOLIA);
  }
  return out;
}

function spendersForPolicy(policy: Policy): string[] {
  const list = policy.allowed_spenders ?? policy.allowed_pay_to ?? [];
  return list.slice();
}

async function resolvePolicy(args: {
  policy_path?: string;
  policy?: unknown;
}): Promise<Policy> {
  if (args.policy !== undefined) {
    return parsePolicy(args.policy);
  }
  if (args.policy_path) {
    return loadPolicy(args.policy_path);
  }
  throw new Error("Either policy_path or policy must be provided");
}

const commonShape = {
  wallet: z.string(),
  network: z.string().optional(),
  tokens: z.array(z.string()).optional(),
  spenders: z.array(z.string()).optional(),
  policy_path: z.string().optional(),
  policy: z.unknown().optional(),
  eip3009_nonces: z.array(z.string()).optional(),
  rpc_url: z.string().optional(),
};

export function createServer(): McpServer {
  const server = new McpServer({
    name: "paystage-auth-watch",
    version: "0.1.0",
  });

  server.tool(
    "list_outstanding_auths",
    "List outstanding token authorizations for a wallet",
    commonShape,
    async (args) => {
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
      const serialized = items.map((i) => ({
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
    }
  );

  server.tool(
    "evaluate_outstanding_auths",
    "List and evaluate outstanding token authorizations against a policy",
    commonShape,
    async (args) => {
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
      const serialized = results.map((r) => ({
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
    }
  );

  return server;
}
