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
import { SIWE_SESSION_COOKIE, open } from "@/lib/siwe/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Common Base spenders to sample (Permit2 + a few routers). Read-only eth_call.
// Keep eth_call count low — public RPCs rate-limit CF egress.
const SAMPLE_SPENDERS = [
  PERMIT2,
  "0x2626664c2603336E57B271c5C0b26F421741e481", // SwapRouter02 Base
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

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function alchemyBaseUrlFromEnv(): string | undefined {
  const direct = process.env.ALCHEMY_BASE_URL?.trim();
  if (direct) return direct;
  const key =
    process.env.ALCHEMY_API_KEY?.trim() ||
    process.env.ALCHEMY_KEY?.trim();
  if (key) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  return undefined;
}

export async function POST(req: Request) {
  // Address comes only from the SIWE session cookie — never from the client body.
  const sessionToken = readCookie(req, SIWE_SESSION_COOKIE);
  if (!sessionToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const session = await open(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }
  const address = session.payload;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_session" }, { status: 401 });
  }

  try {
    const network = "eip155:8453";
    const candidates = [
      alchemyBaseUrlFromEnv(),
      process.env.BASE_RPC_URL?.trim(),
      process.env.NEXT_PUBLIC_BASE_RPC?.trim(),
      "https://1rpc.io/base",
      resolveRpcUrl(network),
    ].filter((u): u is string => !!u && u.length > 0);

    let items: Awaited<ReturnType<typeof listOutstandingAuths>> | null = null;
    let rpcUrl = candidates[0]!;
    let lastErr: unknown;
    for (const url of candidates) {
      try {
        const rpc = createRpcClient(url);
        items = await listOutstandingAuths({
          wallet: address,
          network,
          tokens: [USDC_BASE],
          spenders: SAMPLE_SPENDERS,
          rpc,
          includePermit2: false,
        });
        rpcUrl = url;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!items) {
      throw lastErr instanceof Error ? lastErr : new Error("scan_failed");
    }
    const evaluated = evaluateOutstandingAuths(items, POLICY);
    const usedAlchemy = /alchemy\.com/i.test(rpcUrl);
    return NextResponse.json({
      address,
      chainId: 8453,
      network,
      rpc: usedAlchemy ? "alchemy" : "public",
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
