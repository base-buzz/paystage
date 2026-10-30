// Shared x402 payment helpers for the PayStage "Try it" widget and harnesses.
// Browser + Node compatible ESM. Never logs secrets.
//
// Browser BigInt fix: serializeTypedDataForWallet converts BigInts before
// JSON.stringify for eth_signTypedData_v4 (keeps EIP712Domain for MetaMask).

import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  decodePaymentRequiredHeader as x402DecodeRequired,
  decodePaymentResponseHeader as x402DecodeResponse,
} from "@x402/core/http";

export const NETWORKS = {
  sepolia: {
    key: "sepolia",
    id: "eip155:84532",
    chainId: 84532,
    api: "https://sepolia.api.paystage.xyz",
    explorer: "https://sepolia.basescan.org",
    label: "Base Sepolia",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    mainnet: false,
    faucet: "https://faucet.circle.com",
  },
  mainnet: {
    key: "mainnet",
    id: "eip155:8453",
    chainId: 8453,
    api: "https://api.paystage.xyz",
    explorer: "https://basescan.org",
    label: "Base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    mainnet: true,
    faucet: null,
  },
};

export const CHAIN_PARAMS = {
  84532: {
    chainId: "0x14a34",
    chainName: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
  8453: {
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
};

const ALLOWED_PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const SEPOLIA_USDC = NETWORKS.sepolia.usdc;

function basePolicy(overrides = {}) {
  return {
    version: 1,
    max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: [ALLOWED_PAY_TO],
    allowed_assets: [
      {
        symbol: "USDC",
        decimals: 6,
        address: SEPOLIA_USDC,
        network: "eip155:84532",
      },
    ],
    allowed_networks: ["eip155:84532", "eip155:8453"],
    max_timeout_seconds: 300,
    unknown_payee: "review",
    ...overrides,
  };
}

function basePaymentRequired({ amount, payTo, network = "eip155:84532", asset = SEPOLIA_USDC }) {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network,
        amount: String(amount),
        asset,
        payTo,
        maxTimeoutSeconds: 300,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}

export const PRESETS = {
  small_pay: {
    label: "Small payment (0.002 USDC, allowed payee)",
    expect: "pay",
    body: {
      payment_required: basePaymentRequired({
        amount: "2000",
        payTo: ALLOWED_PAY_TO,
      }),
      policy: basePolicy(),
    },
  },
  over_limit: {
    label: "Over limit (5 USDC vs 1.00 max)",
    expect: "review or do_not_pay",
    body: {
      payment_required: basePaymentRequired({
        amount: "5000000",
        payTo: ALLOWED_PAY_TO,
      }),
      policy: basePolicy(),
    },
  },
  unknown_payee: {
    label: "Unknown payee (0x…dEaD)",
    expect: "review or do_not_pay",
    body: {
      payment_required: basePaymentRequired({
        amount: "2000",
        payTo: "0x000000000000000000000000000000000000dEaD",
      }),
      policy: basePolicy(),
    },
  },
};

export function chainIdHex(chainId) {
  return "0x" + Number(chainId).toString(16);
}

export async function getWalletChainId(ethereum) {
  const hex = await ethereum.request({ method: "eth_chainId" });
  return Number.parseInt(hex, 16);
}

export async function ensureWalletChain(ethereum, targetChainId, chainParams) {
  const target = Number(targetChainId);
  const current = await getWalletChainId(ethereum);
  if (current === target) return { switched: false, chainId: current };

  const params = chainParams || CHAIN_PARAMS[target];
  if (!params) throw new Error(`No chain params for chain ${target}`);

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex(target) }],
    });
  } catch (err) {
    const code = err && (err.code ?? (err.data && err.data.code));
    const msg = String((err && err.message) || "");
    const unrecognized =
      code === 4902 ||
      (code === -32603 && /unrecognized|unknown chain|not added/i.test(msg));
    if (code === 4001) {
      throw new Error("User rejected the chain switch request.");
    }
    if (unrecognized) {
      try {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [params],
        });
      } catch (addErr) {
        const addCode =
          addErr && (addErr.code ?? (addErr.data && addErr.data.code));
        if (addCode === 4001) {
          throw new Error("User rejected adding the network.");
        }
        throw new Error(
          `Could not add network ${params.chainName}: ${
            addErr && addErr.message ? addErr.message : addErr
          }`,
        );
      }
    } else {
      throw new Error(
        `Could not switch network: ${err && err.message ? err.message : err}`,
      );
    }
  }

  const after = await getWalletChainId(ethereum);
  if (after !== target) {
    throw new Error(
      `Wallet is still on chain ${after}; expected ${target}. Please switch manually.`,
    );
  }
  return { switched: true, chainId: after };
}

function deepBigIntToString(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(deepBigIntToString);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = deepBigIntToString(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * Prepare EIP-712 typed data for eth_signTypedData_v4 JSON transport.
 * Converts BigInts → decimal strings; ensures domain.chainId is a number;
 * keeps EIP712Domain in types (MetaMask expects it).
 */
const DEFAULT_EIP712_DOMAIN_TYPES = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

/**
 * MetaMask eth_signTypedData_v4 expects EIP712Domain in types.
 * ExactEvmScheme often omits it — inject a standard definition from domain keys.
 */
function ensureEip712DomainTypes(types, domain) {
  if (types.EIP712Domain && types.EIP712Domain.length) return types;
  const fields = [];
  for (const spec of DEFAULT_EIP712_DOMAIN_TYPES) {
    if (domain[spec.name] !== undefined && domain[spec.name] !== null) {
      fields.push(spec);
    }
  }
  // Fallback if domain is empty/unusual: full standard set.
  types.EIP712Domain = fields.length ? fields : DEFAULT_EIP712_DOMAIN_TYPES.slice();
  return types;
}

export function serializeTypedDataForWallet(typedData) {
  const src = typedData || {};
  const domain = deepBigIntToString(src.domain || {});
  const message = deepBigIntToString(src.message || {});
  let types = deepBigIntToString(src.types || {});

  if (domain.chainId !== undefined && domain.chainId !== null) {
    const n = Number(domain.chainId);
    if (Number.isFinite(n)) domain.chainId = n;
  }

  types = ensureEip712DomainTypes(types, domain);

  return {
    domain,
    types,
    primaryType: src.primaryType,
    message,
  };
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

/** EIP-1193 browser signer → ClientEvmSigner for ExactEvmScheme. */
export function createBrowserSigner(ethereum, address) {
  if (!ethereum || typeof ethereum.request !== "function") {
    throw new Error("No EIP-1193 wallet available");
  }
  if (!address) throw new Error("createBrowserSigner requires an address");
  return {
    address,
    async signTypedData(typedData) {
      const prepared = serializeTypedDataForWallet(typedData);
      const payload = JSON.stringify(prepared, bigintReplacer);
      return ethereum.request({
        method: "eth_signTypedData_v4",
        params: [address, payload],
      });
    },
  };
}

/** Viem local account → ClientEvmSigner (BigInt-safe; no JSON). */
export function createLocalSigner(account) {
  if (!account || typeof account.signTypedData !== "function" || !account.address) {
    throw new Error("createLocalSigner requires a viem account");
  }
  return {
    address: account.address,
    async signTypedData(typedData) {
      return account.signTypedData(typedData);
    },
  };
}

export function decodePaymentRequired(headerValue) {
  if (!headerValue) return null;
  try {
    return x402DecodeRequired(headerValue);
  } catch {
    try {
      return JSON.parse(atob(headerValue));
    } catch {
      return null;
    }
  }
}

export function decodePaymentResponse(headerValue) {
  if (!headerValue) return null;
  try {
    return x402DecodeResponse(headerValue);
  } catch {
    try {
      return JSON.parse(atob(headerValue));
    } catch {
      return null;
    }
  }
}

function explorerTxUrl(networkCaip, txHash) {
  const net =
    networkCaip === NETWORKS.mainnet.id ? NETWORKS.mainnet : NETWORKS.sepolia;
  if (!txHash) return null;
  return `${net.explorer}/tx/${txHash}`;
}


const STRIP_REQUEST_HEADERS = [
  "access-control-expose-headers",
  "Access-Control-Expose-Headers",
];

function headerNames(headers) {
  try {
    return [...new Headers(headers).keys()];
  } catch {
    return [];
  }
}

/**
 * Strip the @x402/fetch mistaken Access-Control-Expose-Headers request header
 * and attach x-paystage-request-id for correlating browser ↔ Worker logs.
 */
export function wrapFetchForTryIt(fetchImpl, { requestId, debug } = {}) {
  const base = fetchImpl ?? globalThis.fetch;
  return async (input, init) => {
    let req;
    if (input instanceof Request && init === undefined) {
      req = input.clone();
    } else {
      req = new Request(input, init);
    }
    const headers = new Headers(req.headers);
    for (const h of STRIP_REQUEST_HEADERS) headers.delete(h);
    if (requestId) headers.set("x-paystage-request-id", requestId);

    const method = req.method;
    const url = req.url;
    debug?.log("fetch:request", {
      url,
      method,
      headerNames: [...headers.keys()],
    });

    const next = new Request(req, { headers });
    let res;
    try {
      res = await base(next);
    } catch (err) {
      debug?.log("fetch:network_error", {
        url,
        method,
        name: err?.name,
        message: err?.message,
        stack: err?.stack ? String(err.stack).slice(0, 500) : undefined,
      });
      throw err;
    }

    debug?.log("fetch:response", {
      url,
      status: res.status,
      hasPaymentRequired: !!(
        res.headers.get("payment-required") ||
        res.headers.get("PAYMENT-REQUIRED")
      ),
      hasPaymentResponse: !!(
        res.headers.get("payment-response") ||
        res.headers.get("PAYMENT-RESPONSE") ||
        res.headers.get("X-PAYMENT-RESPONSE")
      ),
      responseHeaderNames: [...res.headers.keys()],
      requestIdEcho: res.headers.get("x-paystage-request-id"),
    });
    return res;
  };
}

/**
 * POST /v1/evaluate_mcp_payment with x402 payment wrapping.
 * Same wrapFetchWithPaymentFromConfig + ExactEvmScheme path as e2e-paid.
 */
export async function runPaidEvaluate({
  fetchImpl,
  signer,
  baseUrl,
  networkCaip,
  body,
  signal,
  debug,
  requestId,
} = {}) {
  if (!signer || !signer.address || typeof signer.signTypedData !== "function") {
    throw new Error("runPaidEvaluate requires a ClientEvmSigner");
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("No fetch implementation available");
  }
  if (!baseUrl) throw new Error("baseUrl is required");
  if (!body) throw new Error("body is required");
  if (!networkCaip) throw new Error("networkCaip is required");

  const rid =
    requestId ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `rid-${Date.now()}`);
  debug?.log("evaluate:start", { baseUrl, networkCaip, requestId: rid });

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/evaluate_mcp_payment`;
  const instrumented = wrapFetchForTryIt(doFetch, { requestId: rid, debug });
  const scheme = new ExactEvmScheme(signer);
  const paidFetch = wrapFetchWithPaymentFromConfig(instrumented, {
    schemes: [{ network: networkCaip, client: scheme }],
  });

  debug?.log("evaluate:payload_build", { url, method: "POST" });
  let res;
  try {
    res = await paidFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
        "x-paystage-request-id": rid,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    debug?.log("evaluate:error", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack ? String(err.stack).slice(0, 800) : undefined,
    });
    throw err;
  }
  debug?.log("evaluate:done", { status: res.status, requestId: rid });

  const paymentRequiredHeader =
    res.headers.get("PAYMENT-REQUIRED") ??
    res.headers.get("payment-required") ??
    res.headers.get("Payment-Required");
  const paymentResponseHeader =
    res.headers.get("PAYMENT-RESPONSE") ??
    res.headers.get("payment-response") ??
    res.headers.get("X-PAYMENT-RESPONSE") ??
    res.headers.get("Payment-Response");

  const paymentRequired = decodePaymentRequired(paymentRequiredHeader);
  const paymentResponse = decodePaymentResponse(paymentResponseHeader);

  let raw = null;
  const text = await res.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = { raw: text };
    }
  }

  const decision =
    (raw && (raw.decision || (raw.result && raw.result.decision))) || null;

  const txHash =
    (paymentResponse &&
      (paymentResponse.transaction || paymentResponse.txHash)) ||
    (raw &&
      (raw.txHash || (raw.settlement && raw.settlement.transaction))) ||
    null;

  debug?.log("evaluate:result", {
    status: res.status,
    decision,
    txHash: txHash ? `${String(txHash).slice(0, 10)}…` : null,
  });

  return {
    status: res.status,
    decision,
    txHash,
    txUrl: explorerTxUrl(networkCaip, txHash),
    paymentRequired,
    paymentResponse,
    raw,
    requestId: rid,
  };
}
