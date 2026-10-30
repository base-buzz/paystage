import type { PaymentRequest } from "../../src/evaluate.js";

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

export const baseMainnetSmall: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: USDC_BASE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      resource: { url: "mcp://tool/demo" },
    },
  ],
};

export const baseSepoliaSmall: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: USDC_SEPOLIA,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

export const baseMainnetNearHuman: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "600000",
      asset: USDC_BASE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

export const mcpWrapped = {
  isError: true,
  structuredContent: baseMainnetSmall,
  content: [{ type: "text", text: JSON.stringify(baseMainnetSmall) }],
};

export const wrongNetwork: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:1",
      amount: "10000",
      asset: USDC_BASE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

export const unknownAsset: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x1111111111111111111111111111111111111111",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

export const overMax: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000000",
      asset: USDC_BASE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

export const timeoutTooLong: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: USDC_BASE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 9999,
    },
  ],
};

export const emptyAccepts: PaymentRequest = {
  x402Version: 2,
  accepts: [],
};

export const wrongVersion: PaymentRequest = {
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: USDC_BASE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

export const addressCaseFriendly: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
    },
  ],
};
