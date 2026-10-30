#!/usr/bin/env node
// Real Base Sepolia paid e2e against the live Worker.
//
// SECURITY:
// - Private key is read ONLY from the file path in PAYSTAGE_E2E_KEY_FILE.
// - The key is never logged, stringified, or included in errors.
// - Only the derived address is ever printed.
// - Testnet only (eip155:84532 = Base Sepolia). No mainnet.

import { readFileSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const KEY_FILE =
  process.env.PAYSTAGE_E2E_KEY_FILE ||
  "/home/box/.secrets/paystage-sepolia-throwaway.key";

const BASE_URL = process.env.BASE_URL || process.env.PAYSTAGE_E2E_BASE_URL || "https://sepolia.api.paystage.xyz";
const NETWORK = "eip155:84532"; // Base Sepolia (testnet only — mainnet paid e2e intentionally unsupported)

function loadAccount() {
  let raw;
  try {
    raw = readFileSync(KEY_FILE, "utf8");
  } catch (err) {
    // Do not include file contents; only the path and error code.
    throw new Error(
      `Failed to read key file at ${KEY_FILE}: ${err && err.code ? err.code : "unknown error"}`,
    );
  }
  let key = raw.trim();
  if (!key) throw new Error(`Key file at ${KEY_FILE} is empty`);
  if (!key.startsWith("0x")) key = "0x" + key;
  // Validate shape without echoing the key.
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `Key file at ${KEY_FILE} does not contain a valid 32-byte hex private key`,
    );
  }
  return privateKeyToAccount(key);
}

function findPaymentResponseHeader(headers) {
  const names = [
    "PAYMENT-RESPONSE",
    "payment-response",
    "X-PAYMENT-RESPONSE",
    "x-payment-response",
  ];
  for (const name of names) {
    const value = headers.get(name);
    if (value) return { name, value };
  }
  return null;
}

function decodeSafely(value) {
  try {
    return decodePaymentResponseHeader(value);
  } catch (err) {
    return { decodeError: err && err.message ? err.message : String(err) };
  }
}

async function main() {
  const account = loadAccount();
  // Only the address is ever printed.
  console.log("payer address:", account.address);
  console.log("base url:", BASE_URL);
  console.log("network:", NETWORK);

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: NETWORK,
        client: new ExactEvmScheme(account),
      },
    ],
  });

  const body = {
    payment_required: {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          amount: "2000",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
          maxTimeoutSeconds: 300,
          extra: { name: "USDC", version: "2" },
        },
      ],
    },
    policy: {
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
    },
  };

  const url = `${BASE_URL.replace(/\/+$/, "")}/v1/evaluate_mcp_payment`;

  let res;
  try {
    res = await fetchWithPayment(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Never include the key; err from x402/viem should not contain it, but be safe.
    console.error("request failed:", err && err.message ? err.message : String(err));
    process.exit(1);
  }

  console.log("http status:", res.status, res.statusText);

  const header = findPaymentResponseHeader(res.headers);
  if (header) {
    console.log(`payment response header (${header.name}):`, header.value);
    const decoded = decodeSafely(header.value);
    console.log("payment response decoded:", JSON.stringify(decoded, null, 2));
  } else {
    console.log("payment response header: (none)");
  }

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  console.log("response body:", JSON.stringify(parsed, null, 2));

  if (!res.ok) {
    console.error(`non-2xx response: ${res.status}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("e2e failed:", err && err.message ? err.message : String(err));
  process.exit(1);
});
