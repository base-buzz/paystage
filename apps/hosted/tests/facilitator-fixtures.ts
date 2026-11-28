/**
 * Shared fixtures for the self-facilitator tests: a real EIP-3009 signature from a
 * throwaway test account and a stub `FacilitatorEvmSigner`. No key and no RPC here.
 */
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { FacilitatorEvmSigner } from "@x402/evm";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { USDC_BY_NETWORK } from "../src/self-facilitator.js";

export const NETWORK = "eip155:84532";
export const CHAIN_ID = 84532;
export const USDC = USDC_BY_NETWORK[NETWORK] as string;
export const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
export const OTHER = "0x1111111111111111111111111111111111111111";
export const GAS = "0x000000000000000000000000000000000000dEaD";
export const TX = `0x${"ab".repeat(32)}` as `0x${string}`;

// Public synthetic key; holds nothing.
export const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

export function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: USDC,
    amount: "2000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  } as PaymentRequirements;
}

export interface PayloadOverrides {
  requirements?: PaymentRequirements;
  value?: string;
  to?: string;
  validBefore?: number;
  validAfter?: number;
  signatureOverride?: `0x${string}`;
}

export async function signedPayload(overrides: PayloadOverrides = {}): Promise<PaymentPayload> {
  const req = overrides.requirements ?? requirements();
  const value = overrides.value ?? "2000";
  const to = overrides.to ?? req.payTo;
  const now = Math.floor(Date.now() / 1000);
  const validAfter = overrides.validAfter ?? 0;
  const validBefore = overrides.validBefore ?? now + 300;
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const signature =
    overrides.signatureOverride ??
    (await payer.signTypedData({
      domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC as `0x${string}` },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: payer.address,
        to: to as `0x${string}`,
        value: BigInt(value),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce,
      },
    }));

  return {
    x402Version: 2,
    accepted: req,
    payload: {
      authorization: {
        from: payer.address,
        to,
        value,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
      signature,
    },
  };
}

export function makeSigner(options: { failWrite?: boolean } = {}) {
  const calls = { write: 0 };
  const writeContract = async () => {
    calls.write += 1;
    if (options.failWrite) throw new Error("rpc exploded at https://provider.example/?key=do-not-return");
    return TX;
  };
  const signer: FacilitatorEvmSigner = {
    getAddresses: () => [GAS],
    readContract: async () => 0n,
    verifyTypedData: async () => true,
    writeContract,
    sendTransaction: async () => TX,
    waitForTransactionReceipt: async () => ({ status: "success" }),
    getCode: async ({ address }) =>
      address.toLowerCase() === payer.address.toLowerCase() ? undefined : "0x6000",
  };
  return { signer, calls };
}
