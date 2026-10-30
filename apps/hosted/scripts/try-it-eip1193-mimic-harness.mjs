#!/usr/bin/env node
// Mimics injected EIP-1193 provider → exact browser path (createBrowserSigner).
// Key ONLY from PAYSTAGE_E2E_KEY_FILE. Never prints the key. Sepolia only.

import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import {
  NETWORKS,
  PRESETS,
  CHAIN_PARAMS,
  createBrowserSigner,
  runPaidEvaluate,
  ensureWalletChain,
  serializeTypedDataForWallet,
} from "../../../site/try-it/pay.js";

const KEY_FILE =
  process.env.PAYSTAGE_E2E_KEY_FILE ||
  "/home/box/.secrets/paystage-sepolia-throwaway.key";

const TARGET_CHAIN_ID = NETWORKS.sepolia.chainId; // 84532
const WRONG_CHAIN_ID = 1;
const MAX_ATTEMPTS = 3;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hexChain(id) {
  return "0x" + Number(id).toString(16);
}

function testSerializeTypedData() {
  const fake = {
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 84532n,
      verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
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
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      value: 2000n,
      validAfter: 0n,
      validBefore: 9999999999n,
      nonce: "0x" + "11".repeat(32),
    },
  };
  const prepared = serializeTypedDataForWallet(fake);
  if (!prepared.types?.EIP712Domain) {
    throw new Error("EIP712Domain dropped");
  }
  if (typeof prepared.domain.chainId !== "number") {
    throw new Error(`chainId not number: ${typeof prepared.domain.chainId}`);
  }
  const json = JSON.stringify(prepared);
  const parsed = JSON.parse(json);
  if (typeof parsed.message.value === "bigint") {
    throw new Error("BigInt survived stringify");
  }
  if (parsed.message.value !== "2000") {
    throw new Error(`value not decimal string: ${parsed.message.value}`);
  }
  console.log("testSerializeTypedData: OK");
}

function makeFakeEthereum(account) {
  const state = {
    chainId: WRONG_CHAIN_ID,
    switchRequests: [],
    addRequests: [],
    signRequests: [],
    listeners: new Map(),
  };

  function emit(event, payload) {
    const set = state.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch {
        /* ignore */
      }
    }
  }

  const ethereum = {
    isMetaMask: true,
    async request({ method, params }) {
      switch (method) {
        case "eth_chainId":
          return hexChain(state.chainId);
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "wallet_switchEthereumChain": {
          const req = params?.[0]?.chainId;
          state.switchRequests.push(req);
          const id = Number.parseInt(req, 16);
          state.chainId = id;
          emit("chainChanged", hexChain(id));
          return null;
        }
        case "wallet_addEthereumChain": {
          const req = params?.[0];
          state.addRequests.push(req);
          if (req?.chainId) {
            const id = Number.parseInt(req.chainId, 16);
            state.chainId = id;
            emit("chainChanged", hexChain(id));
          }
          return null;
        }
        case "eth_signTypedData_v4": {
          const [addr, jsonStr] = params || [];
          if (addr.toLowerCase() !== account.address.toLowerCase()) {
            throw new Error("signTypedData address mismatch");
          }
          if (typeof jsonStr !== "string") {
            throw new Error("eth_signTypedData_v4 expects JSON string payload");
          }
          // Must not throw on parse — proves BigInt was serialized away.
          const parsed = JSON.parse(jsonStr);
          state.signRequests.push(parsed);

          if (!parsed.types?.EIP712Domain) {
            throw new Error("types.EIP712Domain missing from wire payload");
          }
          if (parsed.primaryType !== "TransferWithAuthorization") {
            throw new Error(`Unexpected primaryType: ${parsed.primaryType}`);
          }
          const assertNoBigInt = (obj, label) => {
            if (!obj || typeof obj !== "object") return;
            for (const [k, v] of Object.entries(obj)) {
              if (typeof v === "bigint") {
                throw new Error(`BigInt leaked in ${label}.${k}`);
              }
              if (v && typeof v === "object") assertNoBigInt(v, `${label}.${k}`);
            }
          };
          assertNoBigInt(parsed.domain, "domain");
          assertNoBigInt(parsed.message, "message");

          const chainIdNum = Number(parsed.domain.chainId);
          if (!Number.isFinite(chainIdNum) || chainIdNum !== TARGET_CHAIN_ID) {
            throw new Error(
              `domain.chainId not ${TARGET_CHAIN_ID}: ${parsed.domain.chainId}`,
            );
          }

          // Rehydrate for viem signing.
          const domain = { ...parsed.domain, chainId: chainIdNum };
          const message = { ...parsed.message };
          for (const f of ["value", "validAfter", "validBefore"]) {
            if (message[f] !== undefined && message[f] !== null) {
              message[f] = BigInt(message[f]);
            }
          }
          // nonce is bytes32 — keep as hex string
          const types = { ...parsed.types };
          delete types.EIP712Domain;

          return account.signTypedData({
            domain,
            types,
            primaryType: parsed.primaryType,
            message,
          });
        }
        default:
          throw new Error(`Unsupported method: ${method}`);
      }
    },
    on(event, fn) {
      if (!state.listeners.has(event)) state.listeners.set(event, new Set());
      state.listeners.get(event).add(fn);
    },
    removeListener(event, fn) {
      state.listeners.get(event)?.delete(fn);
    },
  };

  return { ethereum, state };
}

async function main() {
  testSerializeTypedData();

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
  console.log(`baseUrl: ${NETWORKS.sepolia.api}`);
  console.log(`network: ${NETWORKS.sepolia.id}`);
  console.log(`start chain: ${WRONG_CHAIN_ID} (wrong → expect switch to ${TARGET_CHAIN_ID})`);

  const { ethereum, state } = makeFakeEthereum(account);

  // Browser path: wrong chain → ensureWalletChain → switch → createBrowserSigner
  const switchResult = await ensureWalletChain(
    ethereum,
    TARGET_CHAIN_ID,
    CHAIN_PARAMS[TARGET_CHAIN_ID],
  );
  console.log(`switch: ${JSON.stringify(switchResult)}`);
  if (!state.switchRequests.length && !state.addRequests.length) {
    fail("expected wallet_switchEthereumChain (or add) to be requested");
  }
  if (state.chainId !== TARGET_CHAIN_ID) {
    fail(`chain still ${state.chainId} after ensureWalletChain`);
  }
  console.log(`switch requested: ${state.switchRequests.join(",") || "(via add)"}`);

  const signer = createBrowserSigner(ethereum, account.address);
  const body = PRESETS.small_pay.body;

  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      result = await runPaidEvaluate({
        baseUrl: NETWORKS.sepolia.api,
        body,
        signer,
        networkCaip: NETWORKS.sepolia.id,
      });
    } catch (e) {
      console.error(
        `attempt ${attempt}/${MAX_ATTEMPTS} threw: ${e && e.message ? e.message : e}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1500 * attempt);
        continue;
      }
      fail(`runPaidEvaluate threw: ${e && e.message ? e.message : e}`);
    }
    console.log(
      `attempt ${attempt}: status=${result.status} decision=${result.decision} signs=${state.signRequests.length}`,
    );
    if (result.status === 200 && result.decision === "pay" && result.txHash) {
      if (!state.signRequests.length) {
        fail("expected eth_signTypedData_v4 to have been called");
      }
      const wire = state.signRequests[state.signRequests.length - 1];
      console.log(
        `wire primaryType=${wire.primaryType} hasEIP712Domain=${!!wire.types?.EIP712Domain} chainId=${wire.domain?.chainId}`,
      );
      console.log(`status:   ${result.status}`);
      console.log(`decision: ${result.decision}`);
      console.log(`txUrl:    ${result.txUrl}`);
      console.log("OK");
      return;
    }
    if (attempt < MAX_ATTEMPTS) {
      console.error(`incomplete; retrying…`);
      await sleep(1500 * attempt);
    }
  }

  console.log(`status:   ${result?.status}`);
  console.log(`decision: ${result?.decision}`);
  console.log(`txUrl:    ${result?.txUrl ?? "(none)"}`);
  if (result?.status !== 200) fail(`expected HTTP 200, got ${result?.status}`);
  if (result?.decision !== "pay") {
    fail(`expected decision "pay", got ${result?.decision}`);
  }
  if (!result?.txHash) fail("expected settlement tx hash");
}

main().catch((e) => fail(e?.message || String(e)));
