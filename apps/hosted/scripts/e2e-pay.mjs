#!/usr/bin/env node
// E2E helper stub. This script does NOT contain or handle private keys.
// It prints the 402 challenge from the hosted worker and instructions for
// paying with your own key using an x402 client.
//
// Usage:
//   node scripts/e2e-pay.mjs [baseUrl]
//
// Default baseUrl: http://localhost:8787

const baseUrl = process.argv[2] ?? "http://localhost:8787";

const samplePolicy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      network: "eip155:84532",
    },
  ],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 300,
  unknown_payee: "review",
};

const samplePaymentRequired = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "2000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
  ],
};

const samplePayment = {
  x402Version: 2,
  scheme: "exact",
  network: "eip155:84532",
  payload: {
    signature: "0x" + "00".repeat(65),
    authorization: {
      from: "0x552163d84229865Ca11f2860369239eCf0Eb9Dcb",
      to: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
      value: "2000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0x" + "00".repeat(32),
    },
  },
};

const body = JSON.stringify({
  policy: samplePolicy,
  paymentRequired: samplePaymentRequired,
  payment: samplePayment,
});

const url = `${baseUrl}/v1/evaluate_mcp_payment`;

console.log("=== Unpaid request (expect 402) ===");
console.log(`curl -i -X POST '${url}' \\`);
console.log(`  -H 'content-type: application/json' \\`);
console.log(`  -d '${body}'`);
console.log("");
console.log("=== Next steps ===");
console.log("1. Fund the dev payer wallet (Dave holds the key):");
console.log("   0x552163d84229865Ca11f2860369239eCf0Eb9Dcb");
console.log("   ETH:  https://www.alchemy.com/faucets/base-sepolia");
console.log("   USDC: https://faucet.circle.com (Base Sepolia)");
console.log("2. Run `wrangler dev` in apps/hosted.");
console.log("3. Run the curl above to see the 402 challenge.");
console.log("4. Use an x402 client (x402-fetch / x402-axios) configured with YOUR");
console.log("   dev payer private key to sign and retry. The service never sees");
console.log("   your key.");
console.log("");
console.log("See scripts/e2e-instructions.md for details.");
