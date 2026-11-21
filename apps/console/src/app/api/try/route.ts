import { NextResponse } from "next/server";

/**
 * The try-it demo's backend.
 *
 * Proxied through the server for two reasons: no CORS surface to get wrong, and the label.
 * Every call this route makes is tagged `x-paystage-source: test`, because it is our own
 * tooling — a demo request must never be counted as a real caller or as demand.
 */

const SCENARIOS = {
  allowed: {
    payment: {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "2000", // 0.002 USDC — the real hosted price
          payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
          maxTimeoutSeconds: 60,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      ],
    },
  },
  unknown_payee: {
    payment: {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "2000",
          payTo: "0x1111111111111111111111111111111111111111",
          maxTimeoutSeconds: 60,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      ],
    },
  },
  over_cap: {
    payment: {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "500000000", // 500 USDC against a 0.10 cap
          payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
          maxTimeoutSeconds: 60,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      ],
    },
  },
  needs_human: {
    payment: {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "60000", // 0.06 USDC — under the cap, over the human threshold
          payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
          maxTimeoutSeconds: 60,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      ],
    },
  },
} as const;

const POLICY = {
  version: 1,
  // The hard ceiling stays above the human threshold, so the demo can show a
  // payment that is allowed by the cap but still requires a person.
  max_amount: { value: "0.10", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  require_human_above: { value: "0.05", asset: "USDC", decimals: 6 },
  unknown_payee: "deny",
};

const API = process.env.PAYSTAGE_API_URL ?? "https://api.paystage.xyz";

export async function POST(request: Request) {
  let scenario: keyof typeof SCENARIOS = "allowed";
  let from: string | undefined;
  try {
    const body = (await request.json()) as { scenario?: keyof typeof SCENARIOS; from?: unknown };
    if (body.scenario && body.scenario in SCENARIOS) scenario = body.scenario;
    // Forwarded only so the hosted API can record the listing channel (#326); it normalises and rejects anything
    // outside [a-z0-9._-]{1,32}, so this is transport, not a second set of rules.
    if (typeof body.from === "string" && body.from.length <= 64) from = body.from;
  } catch {
    // No body: run the default scenario rather than fail the demo on a missing field.
  }

  const started = Date.now();
  try {
    const endpoint = new URL(`${API.replace(/\/+$/, "")}/v1/evaluate_mcp_payment`);
    if (from) endpoint.searchParams.set("from", from);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Our own demo traffic, labelled so it is never counted as a real caller.
        "x-paystage-source": "test",
      },
      body: JSON.stringify({ payment_required: SCENARIOS[scenario].payment, policy: POLICY }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as unknown;
    return NextResponse.json({
      scenario,
      status: res.status,
      latencyMs: Date.now() - started,
      verdictHeader: res.headers.get("x-paystage-free-tier"),
      response: body,
    });
  } catch (error) {
    return NextResponse.json(
      {
        scenario,
        status: 0,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
