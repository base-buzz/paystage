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
const NETWORK = "eip155:84532";
const SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/** 0.05 USDC. At $0.002 a run that is 25 runs of headroom, so a low balance is real news. */
const MIN_BALANCE_ATOMIC = 50_000; // Base Sepolia (testnet only — mainnet paid e2e intentionally unsupported)

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
      // TEST-ONLY SURFACE. The free tier answers 200 before wrapFetchWithPayment can ever see a 402,
      // so without these two headers this script would either fail its receipt assertion or — worse —
      // be "fixed" into asserting HTTP 200 and testing nothing. `source: synthetic` keeps the call
      // out of the real-traffic counters; `force-payment` skips the free tier for synthetic callers
      // only. Neither is a product feature.
      headers: {
        "content-type": "application/json",
        "x-paystage-source": "synthetic",
        "x-paystage-force-payment": "1",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Never include the key; err from x402/viem should not contain it, but be safe.
    const message = err && err.message ? err.message : String(err);

    // The first real run of this job reached the handshake and the facilitator rejected it with
    // `invalid_exact_evm_insufficient_balance`. That is the empty wallet, arriving one step earlier
    // than the balance check — and reported as a generic request failure it looks like a product bug,
    // which is the shape that gets an assertion loosened. Same fault, same code, same message.
    if (/insufficient_balance|insufficient funds|exceeds balance/i.test(message)) {
      console.error(
        `FAIL: the test wallet cannot pay — the facilitator rejected the payment for insufficient ` +
          `balance. Fund the wallet; do not loosen the assertion. (${message})`,
      );
      process.exit(4);
    }

    console.error("request failed:", message);
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

  // The failure this job exists to catch. A 200 with no receipt means the free tier answered and no
  // payment happened — a green light over an untested money path. The message says that, because the
  // tempting fix is to relax the assertion.
  if (!header) {
    console.error(
      "FAIL: the free tier answered — this job did not pay. " +
        "Expected a 402 then a PAYMENT-RESPONSE; got 200 with no payment response.",
    );
    process.exit(3);
  }
  const receipt = decodeSafely(header.value);
  if (!receipt || receipt.success !== true) {
    console.error(`FAIL: settlement did not succeed: ${JSON.stringify(receipt)}`);
    process.exit(3);
  }

  const balance = await sepoliaUsdcBalance(account.address);
  if (balance === null || balance < MIN_BALANCE_ATOMIC) {
    console.error(
      `FAIL: the test wallet cannot pay — Sepolia USDC balance is ${balance === null ? "unreadable" : balance} ` +
        `(floor ${MIN_BALANCE_ATOMIC}). Fund it; do not loosen the assertion.`,
    );
    process.exit(4);
  }

  console.log("e2e paid: OK — settled", receipt.transaction ?? receipt.txHash ?? "(no tx in receipt)");
}

/** Sepolia USDC balance, so a drained test wallet fails distinctly from a broken settlement. */
async function sepoliaUsdcBalance(address) {
  try {
    const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const res = await fetch("https://sepolia.base.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: SEPOLIA_USDC, data }, "latest"] }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json();
    return json.result ? Number(BigInt(json.result)) : null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("e2e failed:", err && err.message ? err.message : String(err));
  process.exit(1);
});
