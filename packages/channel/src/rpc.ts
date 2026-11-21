/**
 * Minimal JSON-RPC client. Nothing here can sign: the only method this package
 * ever sends is `eth_call`.
 */
export interface JsonRpcClient {
  request(method: string, params: unknown[]): Promise<unknown>;
}

export type ChainLike = string | number;

export interface ResolvedChain {
  /** CAIP-2 identifier, e.g. `eip155:8453`. */
  network: string;
  chainId: number;
  /** Default public RPC used when no client or rpcUrl is supplied. */
  defaultRpcUrl: string;
}

export function resolveChain(chain: ChainLike): ResolvedChain {
  const raw = typeof chain === "number" ? String(chain) : chain.trim().toLowerCase();
  switch (raw) {
    case "8453":
    case "eip155:8453":
    case "base":
      return {
        network: "eip155:8453",
        chainId: 8453,
        defaultRpcUrl: "https://mainnet.base.org",
      };
    case "84532":
    case "eip155:84532":
    case "base-sepolia":
    case "base_sepolia":
    case "basesepolia":
      return {
        network: "eip155:84532",
        chainId: 84532,
        defaultRpcUrl: "https://sepolia.base.org",
      };
    default:
      throw new Error(
        `Unsupported chain ${JSON.stringify(chain)}; this package reads Base (eip155:8453) and Base Sepolia (eip155:84532) only`,
      );
  }
}

export function createRpcClient(url: string): JsonRpcClient {
  let id = 0;
  return {
    async request(method: string, params: unknown[]): Promise<unknown> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      });
      if (!res.ok) {
        throw new Error(`RPC HTTP ${res.status} ${res.statusText} for ${method}`);
      }
      const json = (await res.json()) as {
        result?: unknown;
        error?: { code: number; message: string };
      };
      if (json.error) {
        throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
      }
      return json.result;
    },
  };
}

export function resolveRpcUrl(
  network: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.PAYSTAGE_RPC_URL;
  if (override && override.trim().length > 0) return override.trim();
  switch (network) {
    case "eip155:8453":
      return "https://mainnet.base.org";
    case "eip155:84532":
      return "https://sepolia.base.org";
    default:
      throw new Error(`No default RPC URL for network ${network}`);
  }
}
