import { Hono } from "hono";

/**
 * `/.well-known/x402` — the compatibility discovery document.
 *
 * x402scan's spec reads discovery in this order: OpenAPI, then this file, then falls back to probing a
 * single URL. This is the cheapest of the three and the only one that lists every paid route at once,
 * so an indexer does not have to guess our paths.
 *
 * `resources` is the whole point: a directory that finds one endpoint lists one endpoint. Ours are
 * listed here, and each still has to answer a real 402 to be indexed as payable — this file
 * advertises, it does not vouch.
 */
export const wellKnownRoutes = new Hono();

const BASE = "https://api.paystage.xyz";

const RESOURCES = [
  `${BASE}/v1/evaluate_mcp_payment`,
  `${BASE}/v1/evaluate_outstanding_auths`,
  `${BASE}/mcp`,
];

wellKnownRoutes.get("/.well-known/x402", (c) => {
  // The ownership proof is the receiving address, so an indexer can tie the resource list to an
  // on-chain identity rather than to whoever typed the URL.
  const payTo = (c.env as { PAYSTAGE_PAY_TO?: string } | undefined)?.PAYSTAGE_PAY_TO ?? null;

  return c.json(
    {
      version: 1,
      resources: RESOURCES,
      ...(payTo ? { ownershipProofs: [payTo] } : {}),
      instructions:
        "Each resource answers an x402 v2 challenge in the Payment-Required header. " +
        `${BASE}/mcp is Streamable HTTP and exposes nine read-only tools.`,
    },
    200,
    { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  );
});
