#!/usr/bin/env node
/**
 * "Returns a signed receipt you can verify offline" — checked against production, in both directions.
 *
 * The repo's tests sign and verify with the same code, which proves the implementation is self-consistent and not that the deployment signs anything. This takes
 * a real receipt from the live API, verifies it against the published key, then flips one field and requires the verification to fail.
 *
 *   node scripts/check-receipt-live.mjs
 *
 * Exit 0 signed receipts verify and tampered ones do not · 10 one direction is broken · 11 the API or key could not be read.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages/mcp/dist/verify-cli.js");
const KEY = "https://api.paystage.xyz/v1/public/receipt-key.json";

const body = {
  payment_required: {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "1000",
        payTo: "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE",
        maxTimeoutSeconds: 300,
      },
    ],
  },
  policy: {
    version: 1,
    max_amount: { value: "1", asset: "USDC", decimals: 6 },
    allowed_pay_to: ["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }],
    allowed_networks: ["eip155:8453"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  },
};

let receipt;
try {
  const res = await fetch("https://api.paystage.xyz/v1/evaluate_mcp_payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  receipt = (await res.json()).receipt;
} catch (error) {
  console.error(`receipt-live: could not read the API — ${String(error).slice(0, 80)}`);
  process.exit(11);
}
if (!receipt) {
  console.error("receipt-live: the API answered without a receipt");
  process.exit(10);
}

const dir = mkdtempSync(join(tmpdir(), "receipt-"));
const good = join(dir, "good.json");
writeFileSync(good, JSON.stringify(receipt));

const verify = (file) => {
  try {
    return { ok: true, out: execFileSync("node", [CLI, file, "--key-url", KEY], { encoding: "utf8", timeout: 30_000 }) };
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? error.stderr ?? "") };
  }
};

const real = verify(good);
if (!real.ok || !/VALID/.test(real.out)) {
  console.error(`receipt-live: a real receipt did not verify — ${real.out.slice(0, 120)}`);
  process.exit(10);
}

const tampered = join(dir, "tampered.json");
const altered = JSON.parse(JSON.stringify(receipt));
altered.verdict = { ...altered.verdict, decision: altered.verdict?.decision === "pay" ? "do_not_pay" : "pay" };
writeFileSync(tampered, JSON.stringify(altered));
const fake = verify(tampered);
if (fake.ok || !/INVALID/.test(fake.out)) {
  console.error("receipt-live: an altered receipt verified — the signature is not covering the verdict");
  process.exit(10);
}

console.log(`receipt-live: real receipt valid, altered receipt invalid (key ${receipt.key_id ?? "?"}, issuer ${receipt.issuer ?? "?"})`);
