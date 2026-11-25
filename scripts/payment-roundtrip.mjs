#!/usr/bin/env node
/**
 * Backlog #400 — one real x402 round trip on Base Sepolia.
 *
 * A seller HTTP call, a real 402, the gate deciding before anything is signed, a
 * settlement through the facilitator, and the transaction hash. Testnet only.
 *
 *   /work/ops/bin/with-secret loadgen \
 *     /work/ops/bin/with-secret paystage \
 *     node scripts/payment-roundtrip.mjs
 *
 * The key is read from LOADGEN_KEY_1 (or PAYSTAGE_E2E_PRIVATE_KEY) and never
 * printed. `--dry-run` stops after the 402 and the gate verdict; `--refuse` runs
 * the same paid path with a cap below the price and shows that nothing is signed.
 *
 * Exit: 0 settled and mined, 1 failed, 2 missing key/usage, 3 gate refused.
 */
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { paystageClientHook } from "@paystage/x402-guard";
import { provenanceHeaders } from "../packages/loadgen/src/provenance.mjs";

const NETWORK = "eip155:84532";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SELLER = "https://sepolia.api.paystage.xyz/v1/paid/evaluate_mcp_payment";
const RPC = "https://sepolia.base.org";
const DRY = process.argv.includes("--dry-run");
const REFUSE = process.argv.includes("--refuse");

/** The product input: a challenge and a policy for the hosted evaluator to judge. */
const REQUEST_BODY = {
  payment_required: {
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: NETWORK,
      amount: "2000",
      asset: USDC,
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    }],
  },
  policy: {
    version: 1,
    max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: NETWORK }],
    allowed_networks: [NETWORK],
    max_timeout_seconds: 300,
    unknown_payee: "review",
  },
};

function decodeRequired(res) {
  const raw = res.headers.get("payment-required") ?? res.headers.get("PAYMENT-REQUIRED");
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function policyFor(accept, maxAmount) {
  return {
    version: 1,
    max_amount: { value: maxAmount, asset: "USDC", decimals: 6 },
    allowed_pay_to: [accept.payTo],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: NETWORK }],
    allowed_networks: [NETWORK],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  };
}

function printAccept(accept) {
  console.log(`  resource:  ${SELLER}`);
  console.log(`  network:   ${accept.network}`);
  console.log(`  asset:     ${accept.asset}`);
  console.log(`  amount:    ${accept.amount} atomic USDC (${(Number(accept.amount) / 1e6).toFixed(6)} USDC)`);
  console.log(`  payTo:     ${accept.payTo}`);
  console.log(`  scheme:    ${accept.scheme}`);
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const key = process.env.LOADGEN_KEY_1;
if (!key) {
  console.error("payment-roundtrip: no key — set LOADGEN_KEY_1 via /work/ops/bin/with-secret loadgen");
  process.exit(2);
}
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key.trim())) {
  console.error("payment-roundtrip: the key is not a 32-byte hex private key (value not printed)");
  process.exit(2);
}
const account = privateKeyToAccount(key.trim().startsWith("0x") ? key.trim() : `0x${key.trim()}`);
const provenance = await provenanceHeaders("own-loadgen");
const headers = {
  "content-type": "application/json",
  "x-paystage-source": "test",
  ...provenance,
};

console.log("PayStage payment clip — a real 402, a gate decision, a Base Sepolia settlement");
console.log(`payer:     ${account.address} (address only; the key is never printed)`);
console.log(`seller:    ${SELLER}`);
console.log(`provenance: ${provenance["x-paystage-provenance"] ?? "unsigned (key absent)"} (label only)`);
console.log("");

// 1. The real unpaid request. This is the seller's actual 402, not a fixture.
const unpaid = await fetch(SELLER, { method: "POST", headers, body: JSON.stringify(REQUEST_BODY) });
console.log(`unpaid request: HTTP ${unpaid.status} ${unpaid.statusText}`);
const challenge = decodeRequired(unpaid);
if (unpaid.status !== 402 || challenge === null) {
  console.error("payment-roundtrip: expected a 402 with a payment-required challenge");
  console.error((await unpaid.text()).slice(0, 800));
  process.exit(1);
}
const accept = challenge.accepts?.[0];
console.log("402 challenge (payment-required header, decoded):");
printAccept(accept);
console.log("");

// 2. The gate decides against the exact challenge the seller sent.
const policy = policyFor(accept, REFUSE ? "0.001" : "0.05");
let gate;
const hook = paystageClientHook({
  policy,
  onReview: "refuse",
  onVerdict: (v) => { gate = v; },
});
const { evaluateBeforeCreation } = await import("@paystage/x402-guard");
const dryVerdict = await evaluateBeforeCreation(
  { paymentRequired: challenge, selectedRequirements: accept },
  { policy, onReview: "refuse", onVerdict: (v) => { gate = v; } },
);
console.log("gate decision (before any signature):");
console.log(`  verdict:   ${gate?.verdict}`);
console.log(`  reasons:   ${JSON.stringify(gate?.reasonCodes ?? [])}`);
console.log(`  proceed:   ${dryVerdict === undefined ? "yes" : "no — " + dryVerdict.reason}`);
console.log("");

if (DRY) {
  console.log("dry run: stopped before signing. Nothing was sent and no funds moved.");
  process.exit(0);
}
if (REFUSE) {
  console.log("refusal run: the policy cap is below the advertised price, so this must not sign.");
  console.log(`result: ${dryVerdict === undefined ? "UNEXPECTED — the gate allowed it" : "blocked as expected, no payment"}`);
  process.exit(dryVerdict === undefined ? 1 : 3);
}

// 3. The paid path: the same gate runs inside the x402 client, before the payload exists.
const client = x402Client.fromConfig({
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
});
client.onBeforePaymentCreation(hook);
const paidFetch = wrapFetchWithPayment(fetch, client);

let res;
try {
  res = await paidFetch(SELLER, {
    method: "POST",
    headers,
    body: JSON.stringify(REQUEST_BODY),
  });
} catch (error) {
  console.error(`payment-roundtrip: the paid request failed — ${String(error?.message ?? error).slice(0, 300)}`);
  process.exit(1);
}

console.log(`paid request: HTTP ${res.status} ${res.statusText}`);
const responseHeader = res.headers.get("payment-response") ?? res.headers.get("PAYMENT-RESPONSE");
if (!responseHeader) {
  console.error("payment-roundtrip: no PAYMENT-RESPONSE — no settlement receipt");
  console.error((await res.text()).slice(0, 800));
  process.exit(1);
}
const receipt = decodePaymentResponseHeader(responseHeader);
const txHash = receipt.transaction ?? receipt.txHash;
console.log("PAYMENT-RESPONSE (decoded):");
console.log(JSON.stringify(receipt, null, 2));
if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
  console.error("payment-roundtrip: the receipt carries no transaction hash");
  process.exit(1);
}

// 4. The proof: ask a public Sepolia RPC for the transaction and its receipt.
const tx = await rpc("eth_getTransactionByHash", [txHash]);
const txReceipt = await rpc("eth_getTransactionReceipt", [txHash]);
console.log("");
console.log("on-chain verification (public RPC, no key):");
console.log(`  eth_getTransactionByHash -> blockNumber ${tx?.blockNumber}, from ${tx?.from}, to ${tx?.to}`);
console.log(`  eth_getTransactionReceipt -> status ${txReceipt?.status}, blockNumber ${txReceipt?.blockNumber}`);
console.log(`  explorer: https://sepolia.basescan.org/tx/${txHash}`);

if (!tx?.blockNumber || txReceipt?.status !== "0x1") {
  console.error("payment-roundtrip: the transaction is not mined with status 0x1");
  process.exit(1);
}
console.log("");
console.log(`transaction hash: ${txHash}`);
process.exit(0);
