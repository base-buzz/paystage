import { NextResponse } from "next/server";

/**
 * The apex's copy of the x402 discovery document.
 *
 * It has to exist on both hosts: agents pay the API host, directories check the apex. The lists are
 * the same list, and the API host remains the one that answers the challenge — this only advertises
 * where to ask.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

const RESOURCES = [
  "https://api.paystage.xyz/v1/evaluate_mcp_payment",
  "https://api.paystage.xyz/v1/evaluate_outstanding_auths",
  "https://api.paystage.xyz/mcp",
];

export function GET() {
  return NextResponse.json(
    {
      version: 1,
      resources: RESOURCES,
      instructions:
        "Each resource answers an x402 v2 challenge in the Payment-Required header. " +
        "https://api.paystage.xyz/mcp is Streamable HTTP and exposes nine read-only tools.",
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
