export const NETWORKS: {
  sepolia: {
    key: string;
    id: string;
    chainId: number;
    api: string;
    explorer: string;
    label: string;
    usdc: string;
    mainnet: boolean;
    faucet: string | null;
  };
  mainnet: {
    key: string;
    id: string;
    chainId: number;
    api: string;
    explorer: string;
    label: string;
    usdc: string;
    mainnet: boolean;
    faucet: string | null;
  };
};
export const CHAIN_PARAMS: Record<number, unknown>;
export const PRESETS: Record<
  string,
  { label: string; expect: string; body: unknown }
>;
export function getWalletChainId(ethereum: unknown): Promise<number>;
export function ensureWalletChain(
  ethereum: unknown,
  targetChainId: number,
  chainParams?: unknown,
): Promise<{ switched: boolean; chainId: number }>;
export function createBrowserSigner(
  ethereum: unknown,
  address: string,
): { address: string; signTypedData(typedData: unknown): Promise<string> };
export function createLocalSigner(account: {
  address: string;
  signTypedData(typedData: unknown): Promise<string>;
}): { address: string; signTypedData(typedData: unknown): Promise<string> };
export function runPaidEvaluate(args: {
  fetchImpl?: typeof fetch;
  signer: { address: string; signTypedData(typedData: unknown): Promise<string> };
  baseUrl: string;
  networkCaip: string;
  body: unknown;
  signal?: AbortSignal;
  debug?: { log(step: string, data?: unknown): void; lines: unknown[] };
  requestId?: string;
  source?: string;
}): Promise<{
  status: number;
  decision: string | null;
  txHash: string | null;
  txUrl: string | null;
  paymentRequired: unknown;
  paymentResponse: unknown;
  raw: unknown;
  requestId: string;
}>;
