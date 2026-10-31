import { NextResponse } from "next/server";
import { evaluatePayment } from "@paystage/preflight";
import type { Policy } from "@paystage/policy";
import { humanToAtomic } from "@paystage/policy";
import { checkVelocity } from "@paystage/velocity";
import { evaluateOutstandingAuths } from "@paystage/auth-watch";
import type { AuthItem } from "@paystage/auth-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEPOLIA = "eip155:84532";
const SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ALLOWED = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const DRAINER = "0x000000000000000000000000000000000000dEaD";
const UNKNOWN = "0x1111111111111111111111111111111111111111";

const DEMO_POLICY: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [ALLOWED],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: MAINNET_USDC,
      network: "eip155:8453",
    },
    {
      symbol: "USDC",
      decimals: 6,
      address: SEPOLIA_USDC,
      network: SEPOLIA,
    },
  ],
  allowed_networks: ["eip155:8453", SEPOLIA],
  max_timeout_seconds: 300,
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "review",
};

function accept(payTo: string, humanAmount: string) {
  return {
    scheme: "exact",
    network: SEPOLIA,
    amount: humanToAtomic(humanAmount, 6).toString(),
    asset: SEPOLIA_USDC,
    payTo,
    maxTimeoutSeconds: 60,
  };
}

function payment(payTo: string, humanAmount: string) {
  return {
    x402Version: 2 as const,
    accepts: [accept(payTo, humanAmount)],
  };
}

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
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = body?.id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    if (id === "paid-sepolia") {
      return NextResponse.json({ error: "client_only" }, { status: 400 });
    }

    if (id === "unlimited-approval" || id === "outstanding-auths") {
      const items: AuthItem[] =
        id === "unlimited-approval"
          ? [
              {
                kind: "erc20_allowance",
                owner: ALLOWED,
                spender: DRAINER,
                token: SEPOLIA_USDC,
                amount: 2n ** 256n - 1n,
                network: SEPOLIA,
              },
            ]
          : [
              {
                kind: "erc20_allowance",
                owner: ALLOWED,
                spender: ALLOWED,
                token: SEPOLIA_USDC,
                amount: humanToAtomic("0.50", 6),
                network: SEPOLIA,
              },
              {
                kind: "erc20_allowance",
                owner: ALLOWED,
                spender: UNKNOWN,
                token: SEPOLIA_USDC,
                amount: humanToAtomic("0.25", 6),
                network: SEPOLIA,
              },
            ];
      const evaluated = evaluateOutstandingAuths(items, DEMO_POLICY);
      const worst = evaluated.some((e) => e.summary === "revoke_recommended")
        ? "revoke_recommended"
        : evaluated.some((e) => e.summary === "review")
          ? "review"
          : "ok";
      const reasons = evaluated.flatMap((e) =>
        e.flags.map((f) => `${e.item.spender.slice(0, 10)}…:${f}`),
      );
      return NextResponse.json({
        id,
        tool: "auth-watch",
        decision: worst,
        reasons,
        detail: serialize(evaluated),
      });
    }

    if (id === "burst-velocity") {
      const now = Date.now();
      const result = checkVelocity({
        history: Array.from({ length: 4 }, (_, i) => ({
          timestamp_ms: now - (i + 1) * 5_000,
          amount_atomic: humanToAtomic("0.001", 6),
        })),
        proposed: {
          timestamp_ms: now,
          amount_atomic: humanToAtomic("0.001", 6),
        },
        windows: [{ window_seconds: 60, max_count: 3 }],
        now_ms: now,
      });
      return NextResponse.json({
        id,
        tool: "velocity",
        decision: result.decision,
        reasons: result.reasons,
        detail: serialize(result),
      });
    }

    const preflightIds: Record<string, { payTo: string; amount: string }> = {
      "known-drainer": { payTo: DRAINER, amount: "0.01" },
      "over-max-amount": { payTo: ALLOWED, amount: "5.00" },
      "unknown-payee": { payTo: UNKNOWN, amount: "0.01" },
      "valid-small-pay": { payTo: ALLOWED, amount: "0.002" },
    };
    const cfg = preflightIds[id];
    if (!cfg) {
      return NextResponse.json({ error: "unknown_scenario" }, { status: 404 });
    }
    const result = evaluatePayment(payment(cfg.payTo, cfg.amount), DEMO_POLICY);
    return NextResponse.json({
      id,
      tool: "preflight",
      decision: result.decision,
      reasons: result.reasons,
      detail: serialize(result),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "evaluation_failed";
    return NextResponse.json(
      { id, tool: "unknown", decision: "error", reasons: [message], detail: null },
      { status: 500 },
    );
  }
}
