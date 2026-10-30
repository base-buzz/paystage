import type { AuthItem } from "./types.js";
import type { JsonRpcClient } from "./rpc.js";
import {
  encodeAllowance,
  encodePermit2Allowance,
  encodeAuthorizationState,
  decodeUint256,
  decodePermit2Allowance,
  decodeBool,
} from "./abis.js";
import { PERMIT2, USDC_BASE, USDC_SEPOLIA } from "./constants.js";

export interface ScanInput {
  wallet: string;
  network: string;
  tokens: string[];
  spenders: string[];
  rpc: JsonRpcClient;
  includePermit2?: boolean;
  eip3009Nonces?: string[];
}

function usdcForNetwork(network: string): string | undefined {
  if (network === "eip155:8453") return USDC_BASE;
  if (network === "eip155:84532") return USDC_SEPOLIA;
  return undefined;
}

async function ethCall(
  rpc: JsonRpcClient,
  to: string,
  data: string
): Promise<string> {
  const result = await rpc.request("eth_call", [{ to, data }, "latest"]);
  if (typeof result !== "string") {
    throw new Error(`eth_call returned non-string for ${to}`);
  }
  return result;
}

export async function listOutstandingAuths(
  input: ScanInput
): Promise<AuthItem[]> {
  const {
    wallet,
    network,
    tokens,
    spenders,
    rpc,
    includePermit2 = true,
    eip3009Nonces,
  } = input;

  const items: AuthItem[] = [];

  for (const token of tokens) {
    for (const spender of spenders) {
      const data = encodeAllowance(wallet, spender);
      const raw = await ethCall(rpc, token, data);
      const amount = decodeUint256(raw);
      if (amount > 0n) {
        items.push({
          kind: "erc20_allowance",
          token,
          owner: wallet,
          spender,
          amount,
          network,
        });
      }
    }
  }

  if (includePermit2) {
    for (const token of tokens) {
      for (const spender of spenders) {
        const data = encodePermit2Allowance(wallet, token, spender);
        const raw = await ethCall(rpc, PERMIT2, data);
        const decoded = decodePermit2Allowance(raw);
        if (decoded.amount > 0n) {
          items.push({
            kind: "permit2",
            token,
            owner: wallet,
            spender,
            amount: decoded.amount,
            network,
            expirationSeconds: decoded.expiration,
            nonce: String(decoded.nonce),
          });
        }
      }
    }
  }

  if (eip3009Nonces && eip3009Nonces.length > 0) {
    const usdc = usdcForNetwork(network);
    if (usdc) {
      for (const nonce of eip3009Nonces) {
        const data = encodeAuthorizationState(wallet, nonce);
        const raw = await ethCall(rpc, usdc, data);
        const invalidated = decodeBool(raw);
        items.push({
          kind: "eip3009",
          token: usdc,
          owner: wallet,
          spender: usdc,
          amount: 0n,
          network,
          nonce,
          raw: { invalidated },
        });
      }
    }
  }

  return items;
}
