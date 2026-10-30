#!/usr/bin/env node
// Sepolia harness — same browser module (site/try-it/pay.js) as the lander widget.
// Key ONLY from PAYSTAGE_E2E_KEY_FILE. Never prints the key. Testnet only.

import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import {
  PRESETS,
  NETWORKS,
  createLocalSigner,
  runPaidEvaluate,
} from "../../../site/try-it/pay.js";

const KEY_FILE =
  process.env.PAYSTAGE_E2E_KEY_FILE ||
  "/home/box/.secrets/paystage-sepolia-throwaway.key";

const BASE_URL = NETWORKS.sepolia.api;
const NETWORK = NETWORKS.sepolia.id;
const PRESET = "small_pay";
const MAX_ATTEMPTS = 3;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let raw;
  try {
    raw = readFileSync(KEY_FILE, "utf8").trim();
  } catch (e) {
    fail(`cannot read key file ${KEY_FILE}: ${e && e.code ? e.code : "error"}`);
  }
  if (!raw) fail("empty key file");
  const privateKey = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    fail(`key file at ${KEY_FILE} is not a valid 32-byte hex private key`);
  }

  let account;
  try {
    account = privateKeyToAccount(privateKey);
  } catch {
    fail("invalid private key");
  }

  console.log(`address: ${account.address}`);
  console.log(`baseUrl: ${BASE_URL}`);
  console.log(`network: ${NETWORK}`);
  console.log(`preset:  ${PRESET}`);

  const preset = PRESETS[PRESET];
  if (!preset) fail(`unknown preset ${PRESET}`);

  const signer = createLocalSigner(account);

  let result;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      result = await runPaidEvaluate({
        baseUrl: BASE_URL,
        body: preset.body,
        signer,
        networkCaip: NETWORK,
      });
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
      console.error(`attempt ${attempt}/${MAX_ATTEMPTS} threw: ${lastErr}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1500 * attempt);
        continue;
      }
      fail(`runPaidEvaluate threw: ${lastErr}`);
    }

    console.log(`attempt ${attempt}: status=${result.status} decision=${result.decision}`);

    if (result.status === 200 && result.decision === "pay" && result.txHash) {
      console.log(`status:   ${result.status}`);
      console.log(`decision: ${result.decision}`);
      console.log(`txUrl:    ${result.txUrl}`);
      console.log("OK");
      return;
    }

    // Facilitator nonce races occasionally return 402 after a signed retry.
    if (attempt < MAX_ATTEMPTS) {
      console.error(
        `attempt ${attempt}/${MAX_ATTEMPTS} incomplete (status=${result.status}); retrying…`,
      );
      await sleep(1500 * attempt);
    }
  }

  console.log(`status:   ${result?.status}`);
  console.log(`decision: ${result?.decision}`);
  console.log(`txUrl:    ${result?.txUrl ?? "(none)"}`);
  if (result?.raw) {
    console.log(`raw keys: ${Object.keys(result.raw).join(",")}`);
  }
  if (result?.status !== 200) fail(`expected HTTP 200, got ${result?.status}`);
  if (result?.decision !== "pay") {
    fail(`expected decision "pay", got ${result?.decision}`);
  }
  if (!result?.txHash) fail("expected settlement tx hash");
}

main().catch((e) => fail(e?.message || String(e)));
