export interface JsonRpcClient {
  request(method: string, params: unknown[]): Promise<unknown>;
}

export function createRpcClient(url: string): JsonRpcClient {
  let id = 0;
  return {
    async request(method: string, params: unknown[]): Promise<unknown> {
      const body = {
        jsonrpc: "2.0",
        id: ++id,
        method,
        params,
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env.PAYSTAGE_RPC_URL;
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  switch (network) {
    case "eip155:8453":
      return "https://mainnet.base.org";
    case "eip155:84532":
      return "https://sepolia.base.org";
    default:
      throw new Error(`No default RPC URL for network ${network}`);
  }
}
