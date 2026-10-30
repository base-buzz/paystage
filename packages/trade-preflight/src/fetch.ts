import type { Snapshot } from "./types.js";

export const DEFAULT_INFO_URL = "https://api.hyperliquid.xyz/info";
export const DEFAULT_DEX = "xyz";

export interface FetchOptions {
  dex?: string;
  infoUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface RawMetaAndAssetCtxs {
  meta: { universe: unknown[]; [key: string]: unknown };
  assetCtxs: unknown[];
}

/**
 * Fetch HIP-3 meta + asset contexts for a dex from the Hyperliquid info endpoint.
 * POST {type:"metaAndAssetCtxs", dex}
 */
export async function fetchMetaAndAssetCtxs(
  dexOrOptions: string | FetchOptions = DEFAULT_DEX,
  maybeOptions: FetchOptions = {},
): Promise<Snapshot> {
  const opts: FetchOptions =
    typeof dexOrOptions === "string"
      ? { ...maybeOptions, dex: dexOrOptions }
      : dexOrOptions;

  const dex = opts.dex ?? DEFAULT_DEX;
  const infoUrl = opts.infoUrl ?? DEFAULT_INFO_URL;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available");
  }

  const res = await fetchImpl(infoUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs", dex }),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(
      `Hyperliquid info request failed: ${res.status} ${res.statusText}`,
    );
  }

  const raw = (await res.json()) as unknown;

  // API returns a tuple: [meta, assetCtxs]
  let meta: RawMetaAndAssetCtxs["meta"];
  let assetCtxs: unknown[];

  if (Array.isArray(raw) && raw.length === 2) {
    meta = raw[0] as RawMetaAndAssetCtxs["meta"];
    assetCtxs = raw[1] as unknown[];
  } else if (
    raw &&
    typeof raw === "object" &&
    "meta" in raw &&
    "assetCtxs" in raw
  ) {
    const obj = raw as RawMetaAndAssetCtxs;
    meta = obj.meta;
    assetCtxs = obj.assetCtxs;
  } else {
    throw new Error("Unexpected metaAndAssetCtxs response shape");
  }

  if (!meta || !Array.isArray(meta.universe)) {
    throw new Error("metaAndAssetCtxs response missing meta.universe");
  }
  if (!Array.isArray(assetCtxs)) {
    throw new Error("metaAndAssetCtxs response missing assetCtxs");
  }

  return {
    dex,
    meta: meta as Snapshot["meta"],
    assetCtxs: assetCtxs as Snapshot["assetCtxs"],
  };
}
