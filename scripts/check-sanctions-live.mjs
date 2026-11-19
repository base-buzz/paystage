#!/usr/bin/env node
/**
 * Does the deployed evaluator actually refuse a sanctioned payee?
 *
 * The repo's list is checked by CI; the *deployed Worker* carries its own copy bundled at build time, and nothing compared the two. A list that shipped stale
 * would look identical from the repo side — and the claim on /lists is "hard deny", which is the strongest word on the page.
 *
 *   node scripts/check-sanctions-live.mjs
 *
 * Exit 0 the deployed API refuses a sanctioned address · 10 it does not · 11 the API could not be read.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "packages/preflight/src/sanctioned-addresses.ts"), "utf8");
const address = /^\s{2}"(0x[0-9a-f]{40})",$/m.exec(source)?.[1];
if (!address) {
  console.error("sanctions-live: no address found in the list — the parse is wrong, not the deployment");
  process.exit(11);
}

const body = {
  payment_required: {
    x402Version: 2,
    resource: { url: "https://example.com/x" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "1000",
        payTo: address,
        maxTimeoutSeconds: 300,
      },
    ],
  },
  policy: {
    version: 1,
    max_amount: { value: "1", asset: "USDC", decimals: 6 },
    // Allow it deliberately: if the allowlist were the reason, the test would pass on a deployment with no sanctions list at all.
    allowed_pay_to: [address],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }],
    allowed_networks: ["eip155:8453"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  },
};

let decision;
try {
  const res = await fetch("https://api.paystage.xyz/v1/evaluate_mcp_payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  decision = await res.json();
} catch (error) {
  console.error(`sanctions-live: could not read the API — ${String(error).slice(0, 80)}`);
  process.exit(11);
}

const reasons = (decision.reasons ?? []).join(" ");
if (decision.decision !== "do_not_pay" || !/sanctioned/i.test(reasons)) {
  console.error(`sanctions-live: the API answered ${decision.decision} for a sanctioned payee — ${reasons.slice(0, 100)}`);
  process.exit(10);
}
console.log(`sanctions-live: deployed API refuses ${address.slice(0, 10)}… with "sanctioned address (OFAC SDN)"`);
