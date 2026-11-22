#!/usr/bin/env node
/**
 * Copyable x402 seller endpoint. ONE paid route, Node standard library only.
 *
 * The point of the file is the order: the gate runs first, before a 402 is advertised and before a
 * payment header is read. Everything else — Bazaar schema, idempotent retries, median price, signed
 * receipt — is there so a stranger can copy a working endpoint instead of a fragment.
 *
 * NOT a service: settlement is simulated, no chain call, no facilitator, no funds move. The receipt
 * is signed with an ephemeral TEST key generated at startup and served for verification.
 *
 *   PAY_TO=0x... node examples/seller/seller.mjs
 */
import { createServer } from "node:http";
import { createHash, webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluatePayment } from "@paystage/preflight";
import { canonicalize } from "@paystage/receipt-verify";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

export const NETWORK = "eip155:8453";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;
export const MEASURED_MEDIAN_ATOMIC = 9000n; // 2026-11-22 snapshot: 13,305 Base-USDC rows, median 9,000
export const SUPPLY_SNAPSHOT_DATE = "2026-11-22";
export const RECEIPT_ALG = "ECDSA-P256-SHA256";
export const TEST_KEY_ID = "seller-example-test-key-v1";
export const RECEIPT_TTL_SECONDS = 300;
export const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
export const PAID_PATH = "/paid/summarize";

const BAZAAR_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 2000, description: "The text to summarise." },
    max_words: { type: "integer", minimum: 1, maximum: 200, default: 60, description: "Summary word limit." },
  },
};

const BAZAAR = {
  info: {
    input: { type: "http", method: "POST", bodyType: "json", body: BAZAAR_INPUT_SCHEMA },
    output: { type: "json", schema: { type: "object", required: ["summary", "words"], properties: { summary: { type: "string" }, words: { type: "integer" } } } },
  },
  // x402scan lists a route without an input schema as non-invocable. This schema describes the same
  // body the handler validates, so the catalogue and the code cannot drift.
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["input"],
    properties: {
      input: {
        type: "object",
        required: ["type", "method", "bodyType", "body"],
        properties: {
          type: { type: "string", const: "http" },
          method: { type: "string", enum: ["POST"] },
          bodyType: { type: "string", enum: ["json"] },
          body: { type: "object" },
        },
      },
      output: { type: "object" },
    },
  },
  routeTemplate: PAID_PATH,
};

const PAYMENT_IDENTIFIER = {
  info: { required: false },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      required: { type: "boolean" },
      id: { type: "string", minLength: 16, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" },
    },
    required: ["required"],
  },
};

/** `10000` -> `0.01`; no floats on the policy path. */
function formatAtomic(atomic, decimals = USDC_DECIMALS) {
  const text = atomic.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return `${whole}${fraction.length > 0 ? `.${fraction}` : ""}`;
}

function sha256Hex(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function decodeHeader(value) {
  try {
    return JSON.parse(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function validatePaymentIdentifier(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
}

/**
 * The median is a measurement, not a preference. Prefer an explicit env var, then a supply snapshot
 * (repo `docs/state/supply/`, or `SELLER_SUPPLY_SNAPSHOT`), then the stated built-in value. The source
 * travels with the result so the server can print which one it used.
 */
export function loadMedian({ snapshotPath, atomicOverride } = {}) {
  if (atomicOverride !== undefined && atomicOverride !== null && String(atomicOverride).trim() !== "") {
    if (!/^\d+$/.test(String(atomicOverride)) || BigInt(atomicOverride) <= 0n) {
      throw new Error(`MEDIAN_ATOMIC must be a positive integer in atomic units, got ${JSON.stringify(atomicOverride)}`);
    }
    return { atomic: BigInt(atomicOverride), source: "env:MEDIAN_ATOMIC", rows: null };
  }

  const candidates = [];
  if (snapshotPath !== undefined && snapshotPath !== null) candidates.push(snapshotPath);
  if (snapshotPath === undefined) {
    candidates.push(join(ROOT, "docs", "state", "supply", `${SUPPLY_SNAPSHOT_DATE}.json`));
    // The measurement lives in /work/ops while it is collected. A repo copy wins when present; this
    // development path is named in the README so nobody mistakes it for a deployed dependency.
    candidates.push(join("/work/ops/docs/state/supply", `${SUPPLY_SNAPSHOT_DATE}.json`));
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const snapshot = JSON.parse(readFileSync(candidate, "utf8"));
    const amounts = (Array.isArray(snapshot.items) ? snapshot.items : [])
      .filter((item) => item?.network === NETWORK
        && String(item?.asset ?? "").toLowerCase() === USDC_BASE.toLowerCase()
        && /^\d+$/.test(String(item?.amount ?? "")))
      .map((item) => Number(item.amount))
      .sort((a, b) => a - b);
    if (amounts.length === 0) continue;
    const middle = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 === 1 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2;
    return { atomic: BigInt(Math.round(median)), source: `snapshot:${candidate}`, rows: amounts.length, measuredAt: snapshot.measured_at };
  }

  return {
    atomic: MEASURED_MEDIAN_ATOMIC,
    source: `builtin:supply-${SUPPLY_SNAPSHOT_DATE} (no snapshot found at ${candidates.join(", ")})`,
    rows: null,
  };
}

/** The first non-pass step is the rule that stopped the evaluation (not the final `result.verdict`). */
function terminalRule(result) {
  for (const step of result.steps) {
    if (step.outcome === "fail" || step.outcome === "review") return step.rule;
  }
  return "result.verdict";
}

function buildPolicy(payTo, maxAmountUsdc) {
  return {
    version: 1,
    max_amount: { value: maxAmountUsdc, asset: "USDC", decimals: USDC_DECIMALS },
    allowed_networks: [NETWORK],
    allowed_assets: [{ symbol: "USDC", decimals: USDC_DECIMALS, address: USDC_BASE, network: NETWORK }],
    allowed_pay_to: [payTo],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  };
}

function buildChallenge(baseUrl, payTo, priceAtomic) {
  return {
    x402Version: 2,
    error: "payment required",
    accepts: [{
      scheme: "exact",
      network: NETWORK,
      asset: USDC_BASE,
      amount: priceAtomic.toString(),
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    }],
    resource: {
      url: `${baseUrl}${PAID_PATH}`,
      description: "Summarise text. Reference x402 seller endpoint, not a hosted service.",
      mimeType: "application/json",
    },
    extensions: { bazaar: BAZAAR, "payment-identifier": PAYMENT_IDENTIFIER },
  };
}

async function generateTestKey() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid: TEST_KEY_ID, use: "sig", alg: "ES256" },
  };
}

async function buildReceipt({ challenge, policy, accept, privateKey, now }) {
  const issued = now ?? new Date();
  const payload = {
    v: 1,
    issuer: "paystage-seller-example",
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + RECEIPT_TTL_SECONDS * 1000).toISOString(),
    service: { name: "@paystage/example-seller", version: "0.1.0" },
    verdict: {
      decision: "pay",
      reasons: [],
      summary: `Decision: pay. Selected ${formatAtomic(BigInt(accept.amount))} USDC on ${accept.network} to ${accept.payTo}.`,
    },
    payment: { scheme: accept.scheme, network: accept.network, asset: accept.asset, amount: accept.amount, payee: accept.payTo },
    request_sha256: sha256Hex(challenge),
    policy_sha256: sha256Hex(policy),
  };
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(canonicalize(payload)),
  );
  return { ...payload, signed: true, alg: RECEIPT_ALG, key_id: TEST_KEY_ID, signature: Buffer.from(signature).toString("base64url") };
}

function receiptId(receipt) {
  const payload = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => !["signed", "alg", "key_id", "signature"].includes(key)),
  );
  return sha256Hex(payload);
}

function paymentMatches(payment, accept) {
  if (payment === null || typeof payment !== "object" || payment.x402Version !== 2) return false;
  const accepted = payment.accepted;
  if (accepted === null || typeof accepted !== "object") return false;
  return accepted.scheme === accept.scheme
    && accepted.network === accept.network
    && String(accepted.asset ?? "").toLowerCase() === accept.asset.toLowerCase()
    && String(accepted.amount ?? "") === accept.amount
    && String(accepted.payTo ?? "").toLowerCase() === accept.payTo.toLowerCase()
    && payment.payload !== null && typeof payment.payload === "object";
}

function identifierFrom(payment, headerValue) {
  if (headerValue !== undefined) return headerValue;
  const id = payment?.extensions?.["payment-identifier"]?.info?.id;
  return typeof id === "string" ? id : undefined;
}

function summarise(text, maxWords) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const chosen = words.slice(0, Math.max(1, Math.min(Number(maxWords ?? 60), 200)));
  return { summary: chosen.join(" ") + (words.length > chosen.length ? " …" : ""), words: chosen.length };
}

function hostBaseUrl(req) {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "http";
  return `${proto}://${req.headers.host ?? "127.0.0.1"}`;
}

/**
 * Build a server without listening. Tests use this; `start` is the executable wrapper.
 */
export async function createSeller(options = {}) {
  const env = options.env ?? process.env;
  const payTo = options.payTo ?? env.PAY_TO;
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(payTo ?? ""))) {
    throw new Error("PAY_TO is required and must be a 20-byte hex address, e.g. PAY_TO=0x209693Bc6afc0C5328bA36FaF03C514EF312287C node examples/seller/seller.mjs");
  }

  const median = loadMedian({
    snapshotPath: options.snapshotPath !== undefined ? options.snapshotPath : env.SELLER_SUPPLY_SNAPSHOT,
    atomicOverride: options.medianAtomic ?? env.MEDIAN_ATOMIC,
  });
  const priceAtomic = BigInt(options.priceAtomic ?? median.atomic);
  if (priceAtomic <= 0n) throw new Error("price must be greater than zero");
  const maxAmountUsdc = options.maxAmountUsdc ?? "0.01";
  const policy = buildPolicy(payTo, maxAmountUsdc);
  const key = options.keyPair ?? (await generateTestKey());
  const now = options.now ?? (() => new Date());
  const silent = options.silent === true;

  const config = {
    payTo, priceAtomic, priceUsd: formatAtomic(priceAtomic), median, maxAmountUsdc,
    network: NETWORK, asset: USDC_BASE, keyId: TEST_KEY_ID, paidPath: PAID_PATH,
  };
  const state = {
    gateCalls: 0,
    lastGate: null,
    simulatedSettlements: 0,
    idempotentReplays: 0,
    receipts: new Map(),
    idempotency: new Map(),
  };

  function gate(challenge) {
    state.gateCalls += 1;
    const result = evaluatePayment(
      { x402Version: 2, accepts: challenge.accepts, resource: challenge.resource },
      policy,
    );
    state.lastGate = { decision: result.decision, rule: terminalRule(result), reasons: result.reasons, summary: result.summary };
    return state.lastGate;
  }

  function pruneIdempotency(at) {
    for (const [id, entry] of state.idempotency) {
      if (at - entry.at > IDEMPOTENCY_TTL_MS) state.idempotency.delete(id);
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/.well-known/paystage-receipt-key.json") {
      return sendJson(res, 200, { keys: [key.publicJwk] });
    }
    const receiptMatch = url.pathname.match(/^\/receipts\/([0-9a-f]{64})$/);
    if (req.method === "GET" && receiptMatch) {
      const receipt = state.receipts.get(receiptMatch[1]);
      return receipt ? sendJson(res, 200, receipt) : sendJson(res, 404, { error: "receipt_not_found" });
    }
    if (url.pathname !== PAID_PATH) return sendJson(res, 404, { error: "not_found" });
    if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" }, { allow: "POST" });

    const challenge = buildChallenge(hostBaseUrl(req), payTo, priceAtomic);

    // THE GATE. Remove this call and an over-cap price starts returning a 402 challenge: the
    // over-cap test asserts a 403 with `accept.max_amount`, so the suite goes red.
    const decision = gate(challenge);
    if (decision.decision !== "pay") {
      return sendJson(res, 403, {
        error: "blocked_by_gate",
        message: `blocked-by-rule: ${decision.rule}`,
        rule: decision.rule,
        verdict: decision.decision,
        reasons: decision.reasons,
      }, { "x-paystage-verdict": decision.decision, "x-paystage-rule": decision.rule });
    }

    const headerRaw = req.headers["payment-signature"] ?? req.headers["x-payment"];
    const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    if (!header) {
      return sendJson(res, 402, challenge, {
        "payment-required": Buffer.from(JSON.stringify(challenge), "utf8").toString("base64"),
        "x-paystage-verdict": decision.decision,
      });
    }

    const payment = decodeHeader(header);
    if (payment === null) return sendJson(res, 400, { error: "invalid_payment", detail: "payment header is not base64 JSON" });
    const identifier = identifierFrom(payment, req.headers["payment-identifier"]);
    if (identifier !== undefined && !validatePaymentIdentifier(String(identifier))) {
      return sendJson(res, 400, { error: "invalid_payment_identifier", detail: "payment-identifier must be 16-128 characters of [A-Za-z0-9_-]" });
    }

    const at = Date.now();
    pruneIdempotency(at);
    if (identifier !== undefined) {
      const cached = state.idempotency.get(identifier);
      if (cached !== undefined) {
        state.idempotentReplays += 1;
        return sendJson(res, cached.status, cached.body, { ...cached.headers, "x-paystage-idempotent-replay": "true" });
      }
    }
    if (!paymentMatches(payment, challenge.accepts[0])) {
      return sendJson(res, 400, { error: "payment_mismatch", detail: "the payment payload does not accept the advertised challenge" });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: "invalid_body", detail: error instanceof Error ? error.message : String(error) });
    }
    if (typeof body.text !== "string" || body.text.trim().length === 0 || body.text.length > 2000) {
      return sendJson(res, 400, { error: "invalid_input", detail: "text must be a non-empty string of at most 2000 characters" });
    }
    if (body.max_words !== undefined && (!Number.isInteger(body.max_words) || body.max_words < 1 || body.max_words > 200)) {
      return sendJson(res, 400, { error: "invalid_input", detail: "max_words must be an integer from 1 to 200" });
    }

    const receipt = await buildReceipt({ challenge, policy, accept: challenge.accepts[0], privateKey: key.privateKey, now: now() });
    const id = receiptId(receipt);
    state.receipts.set(id, receipt);
    state.simulatedSettlements += 1;

    const summary = summarise(body.text, body.max_words);
    const responseBody = {
      ...summary,
      receipt,
      receipt_url: `${hostBaseUrl(req)}/receipts/${id}`,
      settlement: { mode: "simulated", on_chain: false, note: "No funds moved. This example does not verify an EIP-3009 signature or call a facilitator." },
      payment: {
        identifier: identifier ?? null,
        network: challenge.accepts[0].network,
        asset: challenge.accepts[0].asset,
        amount: challenge.accepts[0].amount,
        payee: challenge.accepts[0].payTo,
      },
    };
    const headers = { "x-paystage-verdict": decision.decision, "x-paystage-receipt-id": id, "x-payment-identifier": identifier ?? "" };
    if (identifier !== undefined) state.idempotency.set(identifier, { status: 200, body: responseBody, headers, at });
    return sendJson(res, 200, responseBody, headers);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error", detail: error instanceof Error ? error.message : String(error) });
      else res.end();
    });
  });

  return {
    config, policy, state, server,
    publicJwk: key.publicJwk,
    keyDocument: { keys: [key.publicJwk] },
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolvePromise(`http://${host}:${server.address().port}`);
        });
      });
    },
    close() {
      return new Promise((resolvePromise) => server.close(() => resolvePromise()));
    },
    printBanner(url) {
      if (silent) return;
      console.log("x402 seller example (copyable file, not a hosted service)");
      console.log(`  payTo:   ${payTo}`);
      console.log(`  price:   ${config.priceUsd} USDC (${priceAtomic} atomic)`);
      console.log(`  median:  ${formatAtomic(median.atomic)} USDC (${median.atomic} atomic) from ${median.source}`);
      console.log(`  gate:    max_amount ${maxAmountUsdc} USDC, unknown_payee deny (runs before the 402)`);
      console.log(`  receipt: ${TEST_KEY_ID} — ephemeral test key generated at startup, never a production identity`);
      console.log(`  listen:  ${url}${PAID_PATH}`);
    },
  };
}

export async function start({ port = Number(process.env.PORT ?? 8402), host = "127.0.0.1", ...options } = {}) {
  const seller = await createSeller(options);
  const url = await seller.listen(port, host);
  seller.printBanner(url);
  return { ...seller, url };
}

const isMain = process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    await start({ env: process.env });
  } catch (error) {
    console.error(`seller: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
