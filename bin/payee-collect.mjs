#!/usr/bin/env node
/**
 * Collect the payee observations the classifier reads (#356).
 *
 *   node bin/payee-collect.mjs --address 0x… --out /tmp/payee.json
 *   node bin/payee-collect.mjs --address 0x… --out /tmp/payee.json --ingest
 *   node bin/payee-collect.mjs --address 0x… --conflict-fixture   # synthetic disagreement demo
 *
 * One row per (source, field) with the source named and `observed_at` set to when that source was read. The rows are
 * what `GET /wallets/<address>` serves; this script does not score, rank or merge anything.
 *
 * Sources, and why each is a separate row:
 *   - base-rpc `eth_getCode`            → `code`        (boolean: code present at latest)
 *   - base-rpc `eth_getTransactionCount`→ `nonce`       (outbound transaction count, latest)
 *   - base-rpc `eth_call balanceOf`     → `holds_asset` (USDC balance > 0)
 *   - base-rpc first nonce transition   → `first_seen`  (archive state: block of first outbound tx)
 *   - GoPlus `address_security`         → `goplus`      (one row per positive flag, raw keys mapped)
 *   - OFAC SDN (shipped list)           → `sanctions`
 *   - PayStage known-drainers (shipped) → `drainer`
 *   - PayStage non-receivable (shipped) → `non_receivable`
 *
 * **A source that did not answer is `unknown`, never `false`.** Each network source goes through
 * `collectSource()`, which on a failed read emits zero observations plus a report with `status: "unknown"`; the
 * `unknowns` array in the output is the record. The same rule covers a GoPlus key missing from the body: it is
 * reported as missing, not translated into a negative flag.
 *
 * Place it in /work/paystage rather than /work/ops because it writes the exact rows `apps/hosted` reads, imports the
 * classifier's own field names and the shipped lists from this repo, and its failure-path test lives beside the
 * classifier. An ops-side copy would need a second copy of those names and could drift from the route it feeds.
 *
 * Requires the workspace dist builds for `@paystage/policy` and `@paystage/preflight` (npm run build -w …) because it imports
 * the classifier's exported field names and the shipped lists rather than keeping a second copy of them.
 *
 * Exit codes: 0 rows produced (and written if --out; ingested if --ingest) · 1 control check failed, no row survived,
 * or ingest was rejected · 2 storage_not_configured (no Supabase credentials, or the migration is not applied) ·
 * 64 usage.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  categorise,
  collectSource,
  goPlusObservations,
  mapGoPlusResult,
} from "@paystage/policy";
import {
  KNOWN_DRAINERS,
  NON_RECEIVABLE,
  SANCTIONED_ADDRESSES,
} from "@paystage/preflight";

const RPC = "https://mainnet.base.org";
const BASE_CHAIN_ID = "0x2105";
const PAYMENT_ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const GOPLUS = "https://api.gopluslabs.io/api/v1/address_security";
const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

const argv = process.argv.slice(2);
const argValue = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const ADDRESS = (argValue("--address") ?? "").trim().toLowerCase();
const OUT = argValue("--out");
const INGEST = argv.includes("--ingest");
const CONFLICT = argv.includes("--conflict-fixture");
const KNOWN_FLAGS = new Set(["--address", "--out", "--ingest", "--conflict-fixture", "--help", "-h"]);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "usage: payee-collect.mjs --address 0x<40 hex> [--out <file>] [--ingest] [--conflict-fixture]\n" +
      "  --ingest            POST the observations to payee_observations (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)\n" +
      "  --conflict-fixture  append a clearly labelled synthetic first_seen pair and print the disagreement; never ingested",
  );
  process.exit(0);
}
if (!EVM_ADDRESS_RE.test(ADDRESS)) {
  console.error("payee-collect: --address must be one 0x-prefixed 40-hex EVM address");
  process.exit(64);
}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--") && !KNOWN_FLAGS.has(argv[i])) {
    console.error(`payee-collect: unknown option ${argv[i]}`);
    process.exit(64);
  }
}
if (CONFLICT && INGEST) {
  console.error("payee-collect: --conflict-fixture is a hand-made demonstration and cannot be ingested; drop --ingest");
  process.exit(64);
}

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One JSON-RPC call. HTTP, transport and JSON-RPC errors all throw; the caller turns that into `unknown`. */
async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`${method}: ${body.error.message ?? "JSON-RPC error"}`);
      if (!("result" in body)) throw new Error(`${method}: response has no result`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(750);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const isHex = (value) => typeof value === "string" && /^0x[0-9a-f]*$/i.test(value);
const hexInt = (value, what) => {
  if (!isHex(value) || value === "0x") throw new Error(`${what} is not a hex quantity: ${String(value)}`);
  return Number.parseInt(value, 16);
};

/** The positive control: if the endpoint is not Base, every Base read below is meaningless. */
let chainIdPromise;
function assertBase() {
  chainIdPromise ??= rpc("eth_chainId", []).then((value) => {
    if (value !== BASE_CHAIN_ID) throw new Error(`RPC is chain ${String(value)}, expected Base ${BASE_CHAIN_ID}`);
    return value;
  });
  return chainIdPromise;
}

/** Latest nonce, shared by the `nonce` source and the first-seen binary search's control check. */
let latestNoncePromise;
function latestNonce() {
  latestNoncePromise ??= (async () => {
    await assertBase();
    return hexInt(await rpc("eth_getTransactionCount", [ADDRESS, "latest"]), "nonce");
  })();
  return latestNoncePromise;
}

async function nonceAt(blockNumber) {
  const value = await rpc("eth_getTransactionCount", [ADDRESS, "0x" + blockNumber.toString(16)]);
  return hexInt(value, `nonce at block ${blockNumber}`);
}

const reports = [];
const observations = [];
const warnings = [];

function collect(spec) {
  return collectSource(spec).then((result) => {
    reports.push(result.report);
    observations.push(...result.observations);
    return result;
  });
}

const collectedAt = now();

/**
 * Naming the limits of the dated sources is part of the provenance, not a disclaimer bolted on afterwards.
 * The first-seen row is a *first outbound* transaction: an address that only ever received has no date from it,
 * and a 7702-delegated EOA can look like a contract to `eth_getCode`. Both are stated in the output.
 */
warnings.push(
  "first_seen is the first outbound transaction (first non-zero nonce in archive state), not the first inbound transfer; an address that only received has no first_seen row",
);

// ---- Base RPC -------------------------------------------------------------------------------------------------
/** Captured by the code source's `read` so the EIP-7702 note below needs no second call. */
const baseCode = { value: undefined };
const observedCode = await collect({
  source: "base-rpc eth_getCode",
  observed_at: collectedAt,
  fields: ["code"],
  read: async () => {
    await assertBase();
    const code = await rpc("eth_getCode", [ADDRESS, "latest"]);
    if (!isHex(code)) throw new Error(`eth_getCode returned a non-hex body: ${String(code).slice(0, 40)}`);
    baseCode.value = code;
    return code;
  },
  toObservations: (code) => [
    { source: "base-rpc eth_getCode", observed_at: collectedAt, field: "code", value: code !== "0x" },
  ],
  describe: (code) => (code === "0x" ? "no code at latest block" : `${code.length / 2 - 1} bytes of code at latest block`),
});
if (
  observedCode.report.status === "observed" &&
  typeof baseCode.value === "string" &&
  baseCode.value.toLowerCase().startsWith("0xef0100")
) {
  // EIP-7702 delegation designators make an EOA look like a contract to `eth_getCode`. The classifier has no
  // delegation field, so the label will say `contract`; note the ambiguity rather than hide it.
  warnings.push(
    "code is an EIP-7702 delegation designator (0xef0100…): this is an EOA with delegated code, and the classifier's kind label will read 'contract'",
  );
}

await collect({
  source: "base-rpc eth_getTransactionCount",
  observed_at: collectedAt,
  fields: ["nonce"],
  read: async () => latestNonce(),
  toObservations: (nonce) => [
    { source: "base-rpc eth_getTransactionCount", observed_at: collectedAt, field: "nonce", value: nonce },
  ],
  describe: (nonce) => `${nonce} outbound transaction(s) at latest block`,
});

const balanceOfCall = "0x70a08231" + ADDRESS.replace(/^0x/, "").padStart(64, "0");
await collect({
  source: "base-rpc eth_call balanceOf",
  observed_at: collectedAt,
  fields: ["holds_asset"],
  read: async () => {
    await assertBase();
    const raw = await rpc("eth_call", [{ to: PAYMENT_ASSET, data: balanceOfCall }, "latest"]);
    if (!isHex(raw) || raw === "0x") throw new Error(`balanceOf returned a non-hex body: ${String(raw).slice(0, 40)}`);
    return BigInt(raw);
  },
  toObservations: (balance) => [
    {
      source: "base-rpc eth_call balanceOf",
      observed_at: collectedAt,
      field: "holds_asset",
      value: { asset: PAYMENT_ASSET, holds: balance > 0n },
    },
  ],
  describe: (balance) => `${balance.toString()} raw units of USDC (${(Number(balance) / 1e6).toFixed(6)})`,
});

/**
 * `first_seen` from the first outbound transaction, dated by archive state.
 *
 * Base's public node serves historical `eth_getTransactionCount`, so the first block at which the nonce becomes
 * non-zero is findable by binary search. That dates the address's first *outbound* transaction — not its first
 * inbound transfer, which state cannot reveal. The source label says so, and an address that has never sent is
 * `unknown` rather than dated at genesis. Two controls run on the found block: nonce > 0 there, nonce == 0 one block
 * earlier. If either fails the search is not trusted and the source becomes `unknown`.
 */
await collect({
  source: "base-rpc eth_getTransactionCount (first outbound tx)",
  observed_at: collectedAt,
  fields: ["first_seen"],
  read: async () => {
    await assertBase();
    const latest = await latestNonce();
    if (latest === 0) {
      throw new Error("nonce is 0: no outbound transaction to date, so archive state cannot date a first send");
    }
    const head = hexInt(await rpc("eth_blockNumber", []), "block number");
    let low = 0;
    let high = head;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((await nonceAt(mid)) > 0) high = mid;
      else low = mid + 1;
    }
    const at = await nonceAt(low);
    const before = low === 0 ? 0 : await nonceAt(low - 1);
    if (at === 0) throw new Error(`control failed: nonce at block ${low} is 0`);
    if (before !== 0) throw new Error(`control failed: nonce at block ${low - 1} is ${before}, expected 0`);
    const block = await rpc("eth_getBlockByNumber", ["0x" + low.toString(16), false]);
    if (!block || !isHex(block.timestamp)) throw new Error(`block ${low} has no timestamp`);
    const timestamp = new Date(hexInt(block.timestamp, "block timestamp") * 1000).toISOString();
    if (Date.parse(timestamp) > Date.parse(collectedAt)) throw new Error(`first-seen ${timestamp} is after the read date`);
    return { block: low, timestamp };
  },
  toObservations: (found) => [
    {
      source: "base-rpc eth_getTransactionCount (first outbound tx)",
      observed_at: collectedAt,
      field: "first_seen",
      value: found.timestamp,
    },
  ],
  describe: (found) => `first non-zero nonce at block ${found.block}`,
});

// ---- GoPlus ---------------------------------------------------------------------------------------------------
/**
 * GoPlus answers `address_security` without a key (verified 2026-11-22). `GOPLUS_API_KEY` is optional and only sent
 * as a token when present — it is never printed. If the endpoint starts requiring one, this source becomes `unknown`
 * and the output says so; it never becomes a set of `false` observations.
 */
const goplusToken = process.env.GOPLUS_API_KEY;
await collect({
  source: "GoPlus address_security",
  observed_at: collectedAt,
  fields: ["goplus"],
  read: async () => {
    const headers = { accept: "application/json" };
    if (goplusToken) headers.AccessToken = goplusToken;
    const res = await fetch(`${GOPLUS}/${ADDRESS}?chain_id=8453`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body?.code !== 1 || typeof body.result !== "object" || body.result === null) {
      throw new Error(`GoPlus answered code ${String(body?.code)}: ${String(body?.message).slice(0, 80)}`);
    }
    return mapGoPlusResult(body.result);
  },
  toObservations: (mapping) => goPlusObservations(mapping, "GoPlus address_security", collectedAt),
  describe: (mapping) => {
    const parts = [`flags: ${mapping.flags.length > 0 ? mapping.flags.join(", ") : "none set"}`];
    if (mapping.missing.length > 0) parts.push(`missing (unknown, not false): ${mapping.missing.join(", ")}`);
    if (mapping.unrecognised.length > 0) parts.push(`unrecognised positives: ${mapping.unrecognised.join(", ")}`);
    if (mapping.malformed.length > 0) parts.push(`malformed: ${mapping.malformed.join(", ")}`);
    return parts.join("; ");
  },
});
if (goplusToken === undefined) {
  warnings.push("GoPlus was read from its public endpoint without a key; GOPLUS_API_KEY was not set");
}

// ---- Shipped lists --------------------------------------------------------------------------------------------
const listSources = [
  ["OFAC SDN list (@paystage/preflight)", "sanctions", SANCTIONED_ADDRESSES, "OFAC SDN digital-currency addresses"],
  ["PayStage known-drainers list", "drainer", new Set(KNOWN_DRAINERS.map((a) => a.toLowerCase())), "curated payees"],
  ["PayStage non-receivable list", "non_receivable", new Set(NON_RECEIVABLE.map((a) => a.toLowerCase())), "burn/sink addresses"],
];
for (const [source, field, set, description] of listSources) {
  await collect({
    source,
    observed_at: collectedAt,
    fields: [field],
    read: async () => set.has(ADDRESS),
    toObservations: (listed) => [{ source, observed_at: collectedAt, field, value: listed }],
    describe: (listed) => `${listed ? "on" : "not on"} the ${description} (${set.size} entries)`,
  });
}

// ---- Output ---------------------------------------------------------------------------------------------------
observations.sort(
  (a, b) =>
    a.field.localeCompare(b.field) ||
    a.source.localeCompare(b.source) ||
    String(a.observed_at).localeCompare(String(b.observed_at)),
);
const classified = categorise(observations);
const unknowns = reports
  .filter((report) => report.status === "unknown")
  .map((report) => ({ source: report.source, fields: report.fields, reason: report.detail }));

const output = {
  schema: "paystage.payee-observations.v1",
  address: ADDRESS,
  chain: "eip155:8453",
  payment_asset: PAYMENT_ASSET,
  collected_at: collectedAt,
  observations,
  sources: reports,
  unknowns,
  labels: classified.labels,
  disagreements: classified.disagreements,
  warnings,
};

/** A hand-made pair, clearly labelled synthetic, so the disagreement path can be shown without inventing a source. */
if (CONFLICT) {
  const fixtureRows = [
    {
      source: "synthetic:conflict-fixture-old (#356)",
      observed_at: collectedAt,
      field: "first_seen",
      value: "2017-08-01T00:00:00.000Z",
    },
    {
      source: "synthetic:conflict-fixture-recent (#356)",
      observed_at: collectedAt,
      field: "first_seen",
      value: "2026-11-01T00:00:00.000Z",
    },
  ];
  const fixtureClassified = categorise([...observations, ...fixtureRows]);
  output.fixture = {
    label:
      "synthetic: two hand-made first_seen observations, not network reads. They exist to show the classifier keeps both sides.",
    observations: fixtureRows,
    labels: fixtureClassified.labels.filter((label) => label.field === "age_band"),
    disagreements: fixtureClassified.disagreements,
  };
}

// Human-readable summary. The JSON is the artifact; this is what a person reads.
console.log(`payee-collect: ${ADDRESS} (Base 8453), read ${collectedAt}`);
console.log("source | field | value | observed_at");
for (const row of observations) {
  console.log(`${row.source} | ${row.field} | ${JSON.stringify(row.value)} | ${row.observed_at}`);
}
for (const report of reports.filter((r) => r.status === "unknown")) {
  console.log(`UNKNOWN | ${report.source} | ${report.detail}`);
}
for (const warning of warnings) console.log(`WARNING | ${warning}`);
if (classified.disagreements.length > 0) {
  console.log(`disagreements: ${JSON.stringify(classified.disagreements, null, 1)}`);
} else {
  console.log("disagreements: none between sources for this address");
}
if (CONFLICT) {
  console.log("synthetic conflict fixture:");
  console.log(JSON.stringify(output.fixture, null, 1));
}

if (OUT) {
  try {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");
    console.log(`wrote ${OUT}`);
  } catch (error) {
    console.error(`payee-collect: could not write ${OUT}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (observations.length === 0) {
  console.error("payee-collect: no observation survived; refusing to report a clean-looking empty result");
  process.exit(1);
}

if (INGEST) {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    console.error(
      "payee-collect: storage_not_configured — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so no rows were written. " +
        "Nothing is wrong with the observations above; the store is simply not configured in this environment.",
    );
    process.exit(2);
  }
  const rows = observations.map((row) => ({ address: ADDRESS, ...row }));
  let res;
  try {
    res = await fetch(`${url}/rest/v1/payee_observations`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
  } catch (error) {
    console.error(`payee-collect: storage_not_configured — could not reach the store (${error instanceof Error ? error.message : error}); no rows were written`);
    process.exit(2);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 404 || text.includes("PGRST205") || text.includes("does not exist")) {
      console.error(
        "payee-collect: storage_not_configured — payee_observations is not present in this project (migration " +
          "20261121160000_payee_observations.sql has not been applied). No rows were written; the observations above are complete.",
      );
      process.exit(2);
    }
    console.error(`payee-collect: ingest rejected with HTTP ${res.status}: ${text}`);
    process.exit(1);
  }
  console.log(`ingested ${rows.length} observation row(s) into payee_observations`);
}

process.exit(0);
