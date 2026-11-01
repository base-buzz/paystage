export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const MIN_PAY_ATOMIC = 2000n;

function padAddress(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 40) throw new Error('invalid address');
  return clean.padStart(64, '0');
}

export async function getUsdcBalance(args: { address: string; rpcUrl: string }): Promise<bigint> {
  const { address, rpcUrl } = args;
  const data = `0x70a08231${padAddress(address)}`;

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: USDC_BASE, data }, 'latest'],
    }),
  });

  if (!res.ok) {
    throw new Error(`rpc eth_call failed: status ${res.status}`);
  }

  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) {
    throw new Error(`rpc error: ${json.error.message ?? 'unknown'}`);
  }
  const result = json.result;
  if (typeof result !== 'string' || !result.startsWith('0x')) {
    throw new Error('rpc invalid result');
  }
  if (result === '0x') return 0n;
  return BigInt(result);
}

export async function pickFundedWallet(
  wallets: Array<{ index: number; address: `0x${string}`; account: any }>,
  rpcUrl: string,
): Promise<{ wallet: { index: number; address: `0x${string}`; account: any }; balance: bigint } | null> {
  for (const wallet of wallets) {
    try {
      const balance = await getUsdcBalance({ address: wallet.address, rpcUrl });
      if (balance >= MIN_PAY_ATOMIC) {
        return { wallet, balance };
      }
    } catch {
      // skip silently
    }
  }
  return null;
}
