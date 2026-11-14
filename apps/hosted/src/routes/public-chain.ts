import { Hono } from "hono";

/**
 * Live chain facts, served from our own origin so the site does not have to talk to a public RPC.
 *
 * Two reasons this exists rather than the browser calling Base directly:
 *  - caching: a two-second edge cache means a thousand visitors cost one upstream call, and a public
 *    RPC was never meant to take our traffic
 *  - honesty: whatever we show is what this endpoint observed. If the RPC is down we say so instead of
 *    letting the page invent a number.
 *
 * Nothing here is ours. Block height and gas are Base mainnet's, and they move whether or not anyone
 * uses PayStage — which is exactly why they make the page feel alive without implying activity.
 */
export const publicChainRoutes = new Hono();

const RPC = "https://mainnet.base.org";
const CACHE_SECONDS = 3;

type ChainSnapshot = {
  block: number | null;
  gasGwei: number | null;
  ok: boolean;
  observedAt: string;
  note?: string;
};

async function rpc(method: string): Promise<string | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string };
    return typeof body.result === "string" ? body.result : null;
  } catch {
    return null;
  }
}

publicChainRoutes.get("/v1/public/chain.json", async (c) => {
  const [blockHex, gasHex] = await Promise.all([rpc("eth_blockNumber"), rpc("eth_gasPrice")]);

  const snapshot: ChainSnapshot = {
    block: blockHex ? Number.parseInt(blockHex, 16) : null,
    gasGwei: gasHex ? Number.parseFloat((Number.parseInt(gasHex, 16) / 1e9).toFixed(4)) : null,
    ok: blockHex !== null,
    observedAt: new Date().toISOString(),
  };
  if (!snapshot.ok) snapshot.note = "the public RPC did not answer; this is not a chain stall";

  return c.json(snapshot, 200, {
    // Short, because "live" that lags by a minute is a lie with extra steps.
    "cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
    "access-control-allow-origin": "*",
  });
});
