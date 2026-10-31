import { NextResponse } from "next/server";
import {
  createRpcClient,
  resolveRpcUrl,
  listOutstandingAuths,
  evaluateOutstandingAuths,
  USDC_BASE,
  PERMIT2,
} from "@paystage/auth-watch";
import type { Policy } from "@paystage/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Common Base spenders to sample (Permit2 + a few routers). Read-only eth_call.
const SAMPLE_SPENDERS = [
  PERMIT2,
  "0x2626664c2603336E57B271c5C0b26F421741e481", // SwapRouter02 Base
  "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", // Universal Router
];

const POLICY: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: USDC_BASE,
      network: "eip155:8453",
    },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "review",
};

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out;
  }
  return value;
}

export async function POST(req: Request) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const address = body?.address;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  try {
    const network = "eip155:8453";
    const rpcUrl =
      process.env.NEXT_PUBLIC_BASE_RPC?.trim() ||
      process.env.ALCHEMY_BASE_URL?.trim() ||
      resolveRpcUrl(network);
    const rpc = createRpcClient(rpcUrl);
    const items = await listOutstandingAuths({
      wallet: address,
      network,
      tokens: [USDC_BASE],
      spenders: SAMPLE_SPENDERS,
      rpc,
      includePermit2: true,
    });
    const evaluated = evaluateOutstandingAuths(items, POLICY);
    return NextResponse.json({
      address,
      chainId: 8453,
      network,
      rpc: rpcUrl.includes("alchemy") ? "alchemy" : "public",
      items: serialize(evaluated),
      note:
        items.length === 0
          ? "No non-zero USDC allowances found for the sampled spenders (Permit2 + common routers). Expand the spender set for deeper scans."
          : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "scan_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
