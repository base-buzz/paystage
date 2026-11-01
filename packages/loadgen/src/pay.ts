import { ExactEvmScheme } from '@x402/evm';
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import type { PrivateKeyAccount } from 'viem/accounts';

export const NETWORK = 'eip155:8453';
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const TREASURY = '0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE';
export const AMOUNT_ATOMIC = '2000';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function extractTxHash(headerValue: string | null): string | null {
  if (!headerValue) return null;
  try {
    const parsed = decodePaymentResponseHeader(headerValue) as Record<string, unknown>;
    const tx =
      (parsed as any)?.transaction ??
      (parsed as any)?.txHash ??
      (parsed as any)?.tx_hash;
    if (typeof tx === 'string' && tx.length > 0) return tx;
  } catch {
    // fall through
  }
  try {
    const decoded = decodeURIComponent(headerValue);
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      const tx = (parsed as any).transaction ?? (parsed as any).txHash ?? (parsed as any).tx_hash;
      if (typeof tx === 'string' && tx.length > 0) return tx;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function runPaidSyntheticCall(args: {
  account: PrivateKeyAccount;
  apiBase: string;
}): Promise<{
  ok: boolean;
  status: number;
  txHash: string | null;
  decision: string | null;
  raw: unknown;
  requestId: string;
}> {
  const { account, apiBase } = args;
  const requestId = uuid();

  const body = {
    policy: {
      version: 1,
      max_amount: { value: '1.00', asset: 'USDC', decimals: 6 },
      allowed_pay_to: [TREASURY],
      allowed_assets: [
        {
          symbol: 'USDC',
          decimals: 6,
          address: USDC_BASE,
          network: NETWORK,
        },
      ],
      allowed_networks: [NETWORK],
      max_timeout_seconds: 300,
      unknown_payee: 'review',
    },
    payment_required: {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: NETWORK,
          amount: AMOUNT_ATOMIC,
          asset: USDC_BASE,
          payTo: TREASURY,
          maxTimeoutSeconds: 300,
          extra: { name: 'USDC', version: '2' },
        },
      ],
    },
  };

  const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  });

  const url = `${apiBase.replace(/\/$/, '')}/v1/evaluate_mcp_payment`;

  const res = await paidFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'X-PayStage-Source': 'synthetic',
      'x-paystage-request-id': requestId,
    },
    body: JSON.stringify(body),
  });

  const status = res.status;

  if (!res.ok) {
    throw new Error(`evaluate_mcp_payment failed: status ${status}`);
  }

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }

  let txHash = extractTxHash(
    res.headers.get('PAYMENT-RESPONSE') ??
      res.headers.get('payment-response') ??
      res.headers.get('X-PAYMENT-RESPONSE'),
  );
  if (!txHash && raw && typeof raw === 'object') {
    const r = raw as any;
    const candidate =
      r.txHash ??
      r.transaction ??
      r.tx_hash ??
      r.payment?.txHash ??
      r.payment?.transaction ??
      r.settlement?.txHash ??
      r.settlement?.transaction;
    if (typeof candidate === 'string' && candidate.length > 0) txHash = candidate;
  }

  let decision: string | null = null;
  if (raw && typeof raw === 'object') {
    const d = (raw as any).decision ?? (raw as any).result?.decision;
    if (typeof d === 'string') decision = d;
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    txHash,
    decision,
    raw,
    requestId,
  };
}
