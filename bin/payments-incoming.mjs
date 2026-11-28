#!/usr/bin/env node
/**
 * Classify every USDC Transfer **to** our payTo, so "nobody has paid us" is a measurement rather than a sentence.
 *
 *   node bin/payments-incoming.mjs
 *   node bin/payments-incoming.mjs --days 30 --out apps/console/src/lib/payments-incoming.generated.json
 *   node bin/payments-incoming.mjs --days 7 --json
 *
 * Read-only: `eth_getLogs` and `eth_getBlockByNumber` against a public Base RPC. It never signs, sends, or spends.
 *
 * Three buckets, never two:
 *   ours     — the payer is on the published list in `data/payments/known-payers.json`
 *   external — the payer is readable and not on that list
 *   unknown  — the transfer carries no readable payer (a log with no `from` topic)
 *
 * The address list is published in the repository and copied into the output, because a classifier whose "ours"
 * list is hidden is a classifier nobody can check.
 *
 * Exit 0 success · 10 the window contained no transfers (an empty measurement, not a failure) · 2 RPC or data
 * unreadable · 64 usage.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PAY_TO_TOPIC = `0x${"0".repeat(24)}${PAY_TO.slice(2).toLowerCase()}`;
const PRIMARY_RPC = "https://mainnet.base.org";
/** Public fallbacks. On 2026-11-28 mainnet.base.org answered eth_blockNumber but refused eth_getLogs with
 *  "request limit reached" even for an 11-block range; these endpoints served the same read-only logs. */
const FALLBACK_RPCS = ["https://base-rpc.publicnode.com", "https://base.drpc.org"];
const BLOCK_CHUNK = 50_000;
const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

const argv = process.argv.slice(2);
const argValue = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const KNOWN_FLAGS = new Set(["--days", "--out", "--known-payers", "--rpc", "--json", "--help", "-h"]);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "usage: payments-incoming.mjs [--days N] [--out FILE] [--known-payers FILE] [--rpc URL] [--json]\n" +
      "  --days N          window length in days (default 30)\n" +
      "  --out FILE        JSON snapshot (default apps/console/src/lib/payments-incoming.generated.json)\n" +
      "  --known-payers    published ours-list (default data/payments/known-payers.json)\n" +
      "  --rpc URL         primary public Base RPC (default https://mainnet.base.org)\n" +
      "  --json            print the JSON as well as the human summary\n" +
      "exit: 0 measured · 10 window empty · 2 RPC/data unreadable · 64 usage",
  );
  process.exit(0);
}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--") && !KNOWN_FLAGS.has(argv[i])) {
    console.error(`payments-incoming: unknown option ${argv[i]}`);
    process.exit(64);
  }
}

const days = Number(argValue("--days") ?? 30);
if (!Number.isInteger(days) || days <= 0 || days > 3660) {
  console.error("payments-incoming: --days must be a positive integer (<= 3660)");
  process.exit(64);
}
const OUT = resolve(process.cwd(), argValue("--out") ?? join(ROOT, "apps/console/src/lib/payments-incoming.generated.json"));
const KNOWN_PAYERS = resolve(process.cwd(), argValue("--known-payers") ?? join(ROOT, "data/payments/known-payers.json"));
const PRIMARY = argValue("--rpc") ?? PRIMARY_RPC;
const PRINT_JSON = argv.includes("--json");
const ENDPOINTS = [PRIMARY, ...FALLBACK_RPCS.filter((url) => url !== PRIMARY)];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One JSON-RPC call to one endpoint. Transport, HTTP and JSON-RPC errors all throw. */
async function post(endpoint, method, params) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`${endpoint}: ${method}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`${endpoint}: ${method}: HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`${endpoint}: ${method}: response is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (body.error) throw new Error(`${endpoint}: ${method}: ${body.error.message ?? "JSON-RPC error"}${body.error.code ? ` (${body.error.code})` : ""}`);
  if (!("result" in body)) throw new Error(`${endpoint}: ${method}: response has no result`);
  return body.result;
}

/** Endpoints that answered at least once, and the one that last served logs (printed in the snapshot). */
const endpointsUsed = new Set();
let logsEndpoint = null;

/**
 * Call a method, rotating through public endpoints. The primary is tried first; a failing endpoint is skipped for
 * the rest of the call, and for logs the first endpoint that answers becomes the one the run keeps using — so a
 * provider that blocks eth_getLogs costs one failed request, not one per chunk.
 */
async function rpc(method, params) {
  const order = method === "eth_getLogs" && logsEndpoint ? [logsEndpoint, ...ENDPOINTS.filter((url) => url !== logsEndpoint)] : ENDPOINTS;
  const errors = [];
  for (const endpoint of order) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await post(endpoint, method, params);
        endpointsUsed.add(endpoint);
        if (method === "eth_getLogs") logsEndpoint = endpoint;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        // A range error is about the request, not the endpoint — do not burn the second attempt or the next host.
        if (/block range|range too|exceed maximum|too many blocks/i.test(message)) break;
        if (attempt === 0) await sleep(500);
      }
    }
  }
  throw new Error(`all public RPCs failed for ${method}: ${errors.slice(-3).join(" | ")}`);
}

/** Block timestamps are immutable, so one read per block is enough. */
const blockCache = new Map();
async function getBlock(numberOrTag) {
  const key = String(numberOrTag).toLowerCase();
  if (blockCache.has(key)) return blockCache.get(key);
  const block = await rpc("eth_getBlockByNumber", [key.startsWith("0x") ? key : numberOrTag, false]);
  if (!block || block.number === undefined || block.timestamp === undefined) {
    throw new Error(`eth_getBlockByNumber(${numberOrTag}) returned no block`);
  }
  const parsed = { number: Number(BigInt(block.number)), timestamp: Number(BigInt(block.timestamp)), hash: block.hash ?? null };
  blockCache.set(key, parsed);
  return parsed;
}

const toHex = (value) => `0x${value.toString(16)}`;

/** The first block at or after `target`, by binary search on block timestamps. */
async function firstBlockAtOrAfter(target, latest) {
  let low = 0;
  let high = latest.number;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await getBlock(toHex(mid));
    if (block.timestamp < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** USDC has six decimals; keep atomic units internally and format once at the edge. */
function usdc(atomic) {
  const text = atomic.toString().padStart(7, "0");
  return `${text.slice(0, -6)}.${text.slice(-6)}`;
}

function decodeTransfer(log) {
  const topics = Array.isArray(log.topics) ? log.topics : [];
  const fromTopic = typeof topics[1] === "string" ? topics[1].toLowerCase() : "";
  const toTopic = typeof topics[2] === "string" ? topics[2].toLowerCase() : "";
  const payer = /^0x[0-9a-f]{64}$/.test(fromTopic) ? `0x${fromTopic.slice(-40)}` : null;
  const recipient = /^0x[0-9a-f]{64}$/.test(toTopic) ? `0x${toTopic.slice(-40)}` : null;
  let atomic = null;
  try {
    atomic = BigInt(log.data);
  } catch {
    atomic = null;
  }
  return {
    tx: log.transactionHash ?? null,
    block: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex ?? 0)),
    payer,
    recipient,
    atomic,
  };
}

/**
 * Read the logs in chunks. Public RPCs cap the block span; on that error halve the chunk instead of failing the run,
 * and on a provider error rotate (handled inside rpc()).
 */
async function readTransferLogs(fromBlock, toBlock) {
  const logs = [];
  let step = BLOCK_CHUNK - 1;
  for (let from = fromBlock; from <= toBlock; ) {
    const to = Math.min(from + step, toBlock);
    try {
      const chunk = await rpc("eth_getLogs", [
        {
          address: USDC,
          fromBlock: toHex(from),
          toBlock: toHex(to),
          topics: [TRANSFER_TOPIC, null, PAY_TO_TOPIC],
        },
      ]);
      for (const log of Array.isArray(chunk) ? chunk : []) {
        if (log?.removed === true) continue;
        if (String(log?.address ?? "").toLowerCase() !== USDC.toLowerCase()) continue;
        if (String(log?.topics?.[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
        if (String(log?.topics?.[2] ?? "").toLowerCase() !== PAY_TO_TOPIC) continue;
        logs.push(log);
      }
      from = to + 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/block range|range too|exceed maximum|too many blocks/i.test(message) && step > 999) {
        step = Math.floor(step / 2);
        continue;
      }
      throw error;
    }
  }
  return logs;
}

/** Run an async mapper with a small concurrency cap, so a 30-day run does not open hundreds of sockets. */
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function readKnownPayers() {
  if (!existsSync(KNOWN_PAYERS)) {
    throw new Error(`published ours-list is missing at ${KNOWN_PAYERS}`);
  }
  const raw = JSON.parse(readFileSync(KNOWN_PAYERS, "utf8"));
  if (raw.schema !== "paystage-known-payers/v1" || !Array.isArray(raw.addresses) || raw.addresses.length === 0) {
    throw new Error(`${KNOWN_PAYERS} is not a paystage-known-payers/v1 list with addresses`);
  }
  const seen = new Set();
  const addresses = [];
  for (const entry of raw.addresses) {
    const address = String(entry.address ?? "").toLowerCase();
    if (!EVM_ADDRESS_RE.test(address)) throw new Error(`${KNOWN_PAYERS}: invalid address ${JSON.stringify(entry.address)}`);
    if (seen.has(address)) throw new Error(`${KNOWN_PAYERS}: duplicate address ${entry.address}`);
    seen.add(address);
    addresses.push({
      address: entry.address,
      label: String(entry.label ?? ""),
      role: String(entry.role ?? "unknown"),
      ...(entry.retired === true ? { retired: true } : {}),
      source: String(entry.source ?? ""),
    });
  }
  return { updated: String(raw.updated ?? ""), note: String(raw.note ?? ""), addresses };
}

function classify(payer, ours) {
  if (!payer || !EVM_ADDRESS_RE.test(payer)) return "unknown";
  return ours.has(payer) ? "ours" : "external";
}

/* ---------------------------------------------------------------- run ---------------------------------------------------------------- */

let known;
try {
  known = readKnownPayers();
} catch (error) {
  console.error(`payments-incoming: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const ours = new Set(known.addresses.map((entry) => entry.address.toLowerCase()));

let latest;
let startBlock;
let rawLogs;
try {
  latest = await getBlock("latest");
  const target = latest.timestamp - days * 86_400;
  startBlock = await firstBlockAtOrAfter(target, latest);
  const start = await getBlock(toHex(startBlock));
  console.error(
    `payments-incoming: reading USDC Transfer logs to ${PAY_TO} over blocks ${startBlock}..${latest.number} ` +
      `(${new Date(start.timestamp * 1000).toISOString()} .. ${new Date(latest.timestamp * 1000).toISOString()})`,
  );
  rawLogs = await readTransferLogs(startBlock, latest.number);
} catch (error) {
  console.error(`payments-incoming: chain data unreadable — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const decoded = rawLogs
  .map(decodeTransfer)
  .filter((row) => row.recipient === PAY_TO.toLowerCase())
  .filter((row) => row.tx && Number.isInteger(row.block));

let timestamps;
try {
  const blocks = [...new Set(decoded.map((row) => row.block))];
  const lookedUp = await mapLimit(blocks, 5, async (block) => [block, (await getBlock(toHex(block))).timestamp]);
  timestamps = new Map(lookedUp);
} catch (error) {
  console.error(`payments-incoming: block timestamps unreadable — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const transfers = decoded
  .map((row) => {
    const bucket = classify(row.payer, ours);
    const timestamp = timestamps.get(row.block);
    return {
      tx: row.tx,
      block: row.block,
      logIndex: row.logIndex,
      at: new Date(timestamp * 1000).toISOString(),
      payer: row.payer,
      bucket,
      oursLabel: bucket === "ours" ? known.addresses.find((entry) => entry.address.toLowerCase() === row.payer)?.label ?? null : null,
      amountAtomic: row.atomic === null ? null : row.atomic.toString(),
      amountUsdc: row.atomic === null ? null : usdc(row.atomic),
    };
  })
  .sort((a, b) => (a.block - b.block) || (a.logIndex - b.logIndex));

const counts = { transfers: transfers.length, ours: 0, external: 0, unknown: 0 };
const payerMap = new Map();
let totalAtomic = 0n;
for (const transfer of transfers) {
  counts[transfer.bucket] += 1;
  if (transfer.amountAtomic !== null) totalAtomic += BigInt(transfer.amountAtomic);
  const key = transfer.payer ?? "unknown";
  const existing = payerMap.get(key) ?? {
    payer: transfer.payer,
    bucket: transfer.bucket,
    label: transfer.oursLabel,
    transfers: 0,
    amountAtomic: 0n,
    firstAt: transfer.at,
    lastAt: transfer.at,
  };
  existing.transfers += 1;
  if (transfer.amountAtomic !== null) existing.amountAtomic += BigInt(transfer.amountAtomic);
  if (transfer.at < existing.firstAt) existing.firstAt = transfer.at;
  if (transfer.at > existing.lastAt) existing.lastAt = transfer.at;
  payerMap.set(key, existing);
}
const payers = [...payerMap.values()]
  .map((payer) => ({ ...payer, amountAtomic: payer.amountAtomic.toString(), amountUsdc: usdc(payer.amountAtomic) }))
  .sort((a, b) => b.transfers - a.transfers || a.payer.localeCompare(b.payer));
counts.distinctPayers = new Set(transfers.map((row) => row.payer).filter(Boolean)).size;

const externalTransfers = transfers.filter((row) => row.bucket === "external");
const lastExternal =
  externalTransfers.length === 0
    ? null
    : externalTransfers.reduce((latest, row) => (row.at > latest.at ? row : latest), externalTransfers[0]);

const start = await getBlock(toHex(startBlock));
const window = {
  days,
  start: new Date(start.timestamp * 1000).toISOString(),
  end: new Date(latest.timestamp * 1000).toISOString(),
  label: `${new Date(start.timestamp * 1000).toISOString().slice(0, 10)}..${new Date(latest.timestamp * 1000).toISOString().slice(0, 10)}`,
  fromBlock: startBlock,
  toBlock: latest.number,
};

const snapshot = {
  schema: "paystage-incoming-payments/v1",
  generatedAt: new Date().toISOString(),
  network: "eip155:8453",
  asset: { symbol: "USDC", address: USDC, decimals: 6 },
  payTo: PAY_TO,
  window,
  rpc: { primary: PRIMARY, used: [...endpointsUsed], logs: logsEndpoint },
  counts,
  totals: { amountAtomic: totalAtomic.toString(), amountUsdc: usdc(totalAtomic) },
  lastExternal: lastExternal ? { date: lastExternal.at.slice(0, 10), at: lastExternal.at, tx: lastExternal.tx, payer: lastExternal.payer } : null,
  knownPayers: known.addresses,
  knownPayersSource: "data/payments/known-payers.json",
  payers,
  transfers,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);

console.log(`payments-incoming: ${counts.transfers} USDC Transfer(s) to ${PAY_TO} in the last ${days} days`);
console.log(`  window: ${window.start} .. ${window.end} (blocks ${window.fromBlock}..${window.toBlock})`);
console.log(`  total: ${snapshot.totals.amountUsdc} USDC across ${counts.distinctPayers} distinct payer(s)`);
console.log(`  ours ${counts.ours} · external ${counts.external} · unknown ${counts.unknown}`);
console.log(`  last external payment: ${lastExternal ? lastExternal.at.slice(0, 10) : "none"}`);
console.log(`  ours list (${known.addresses.length} published in ${snapshot.knownPayersSource}):`);
for (const entry of known.addresses) {
  console.log(`    ${entry.address}  ${entry.label}${entry.retired ? " (retired)" : ""}  [${entry.role}]  ${entry.source}`);
}
console.log(`  logs read via: ${logsEndpoint ?? "none"}`);
console.log(`  snapshot: ${OUT}`);
if (counts.unknown > 0) {
  console.error(`  WARNING: ${counts.unknown} transfer(s) carry no readable payer and are unknown, not external.`);
}

if (PRINT_JSON) console.log(JSON.stringify(snapshot, null, 2));
if (counts.transfers === 0) {
  console.log("payments-incoming: the window contained no transfers (exit 10 — an empty measurement, not a failure)");
  process.exit(10);
}
process.exit(0);
