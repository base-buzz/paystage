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

// Coinbase's public RPC refused the Worker's egress while answering from a laptop, so a single host
// made the endpoint permanently "unreachable". Several no-key endpoints, tried in order: whichever
// answers first wins, and a failure names itself rather than looking like a chain stall.
const RPCS = [
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
  "https://mainnet.base.org",
];
const CACHE_SECONDS = 3;

type ChainSnapshot = {
  block: number | null;
  gasGwei: number | null;
  ok: boolean;
  observedAt: string;
  note?: string;
};

async function rpc(method: string): Promise<{ value: string | null; via: string | null }> {
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { result?: string };
      if (typeof body.result === "string") return { value: body.result, via: new URL(url).host };
    } catch {
      // try the next one
    }
  }
  return { value: null, via: null };
}

publicChainRoutes.get("/v1/public/chain.json", async (c) => {
  const [block, gas] = await Promise.all([rpc("eth_blockNumber"), rpc("eth_gasPrice")]);

  const snapshot: ChainSnapshot & { via?: string | null } = {
    block: block.value ? Number.parseInt(block.value, 16) : null,
    gasGwei: gas.value ? Number.parseFloat((Number.parseInt(gas.value, 16) / 1e9).toFixed(4)) : null,
    ok: block.value !== null,
    observedAt: new Date().toISOString(),
    via: block.via,
  };
  if (!snapshot.ok) snapshot.note = "the public RPC did not answer; this is not a chain stall";

  return c.json(snapshot, 200, {
    // Short, because "live" that lags by a minute is a lie with extra steps.
    "cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
    "access-control-allow-origin": "*",
  });
});
