#!/usr/bin/env node
/**
 * `/pricing` says how many transfers reached our payee, how many were ours, and when an external one last arrived.
 * This checks the sentence's backing data, not the sentence's taste.
 *
 *   node scripts/check-payments-incoming.mjs
 *
 * Exit 0 clean · 1 a claim is unbacked · 2 a file is missing or unreadable.
 *
 * Checks:
 *   - the snapshot parses as `paystage-incoming-payments/v1` and has a dated 30-day window;
 *   - counts sum to the rows, the total sums to the amounts, and the last external date is the newest external row;
 *   - every transfer is classified exactly once against the published list (ours / external / unknown);
 *   - the snapshot's copied list is the published list, so the page cannot show a different list from the classifier;
 *   - the page formats the snapshot through `formatSentence` and does not type a count into JSX.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "apps/console/src/lib/payments-incoming.generated.json");
const KNOWN = join(ROOT, "data/payments/known-payers.json");
const PAGE = join(ROOT, "apps/console/src/app/pricing/page.tsx");
const BUCKETS = new Set(["ours", "external", "unknown"]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const problems = [];
const fail = (message) => problems.push(message);

function readJson(path, label) {
  if (!existsSync(path)) {
    console.error(`payments-incoming-check: ${label} is missing at ${path.replace(`${ROOT}/`, "")}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`payments-incoming-check: ${label} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

const snapshot = readJson(SNAPSHOT, "snapshot");
const published = readJson(KNOWN, "published ours-list");

if (snapshot.schema !== "paystage-incoming-payments/v1") fail(`snapshot schema is ${JSON.stringify(snapshot.schema)}`);
if (snapshot.network !== "eip155:8453") fail(`snapshot network is ${JSON.stringify(snapshot.network)}, expected eip155:8453`);
if (snapshot.asset?.symbol !== "USDC" || snapshot.asset?.decimals !== 6) fail("snapshot asset is not 6-decimal USDC");
if (!ADDRESS_RE.test(String(snapshot.payTo ?? ""))) fail("snapshot payTo is not an address");
if (typeof snapshot.generatedAt !== "string" || Number.isNaN(Date.parse(snapshot.generatedAt))) fail("snapshot generatedAt is not a timestamp");

const window = snapshot.window ?? {};
if (!Number.isInteger(window.days) || window.days <= 0) fail("snapshot window.days is not a positive integer");
if (!Number.isInteger(window.fromBlock) || !Number.isInteger(window.toBlock) || window.fromBlock > window.toBlock) {
  fail("snapshot window blocks are not a valid range");
}
if (typeof window.start !== "string" || typeof window.end !== "string") fail("snapshot window start/end missing");
else if (Date.parse(window.start) > Date.parse(window.end)) fail("window start is after window end");
else if (window.end.slice(0, 10) !== snapshot.generatedAt.slice(0, 10)) fail("window end and generatedAt are not the same day");

if (!published || published.schema !== "paystage-known-payers/v1" || !Array.isArray(published.addresses) || published.addresses.length === 0) {
  fail("published ours-list is not a non-empty paystage-known-payers/v1 list");
}
const publishedAddresses = new Set((published.addresses ?? []).map((entry) => String(entry.address).toLowerCase()));
const snapshotAddresses = new Set((snapshot.knownPayers ?? []).map((entry) => String(entry.address).toLowerCase()));
if (publishedAddresses.size !== snapshotAddresses.size) fail("snapshot knownPayers is not the published list");
for (const address of publishedAddresses) if (!snapshotAddresses.has(address)) fail(`snapshot is missing published address ${address}`);
for (const address of snapshotAddresses) if (!publishedAddresses.has(address)) fail(`snapshot carries an address that is not published: ${address}`);

const transfers = Array.isArray(snapshot.transfers) ? snapshot.transfers : [];
if (transfers.length === 0) fail("snapshot has no transfers — an empty window must be stated, not hidden");
if (snapshot.counts?.transfers !== transfers.length) fail(`counts.transfers ${snapshot.counts?.transfers} != ${transfers.length} rows`);

const counts = { ours: 0, external: 0, unknown: 0 };
let totalAtomic = 0n;
let lastExternal = null;
for (const [index, transfer] of transfers.entries()) {
  const where = `transfers[${index}] ${transfer.tx ?? "(no tx)"}`;
  if (typeof transfer.tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transfer.tx)) fail(`${where}: tx is not a 32-byte hash`);
  if (!Number.isInteger(transfer.block) || transfer.block <= 0) fail(`${where}: block is not a positive integer`);
  if (typeof transfer.at !== "string" || Number.isNaN(Date.parse(transfer.at))) fail(`${where}: at is not a timestamp`);
  if (!BUCKETS.has(transfer.bucket)) fail(`${where}: unclassified bucket ${JSON.stringify(transfer.bucket)}`);
  else counts[transfer.bucket] += 1;
  if (transfer.payer === null) {
    if (transfer.bucket !== "unknown") fail(`${where}: no payer but bucket ${transfer.bucket}`);
  } else {
    if (!ADDRESS_RE.test(String(transfer.payer))) fail(`${where}: payer is not an address`);
    const expected = publishedAddresses.has(String(transfer.payer).toLowerCase()) ? "ours" : "external";
    if (transfer.bucket !== expected) fail(`${where}: payer ${transfer.payer} is ${expected}, snapshot says ${transfer.bucket}`);
  }
  if (typeof transfer.amountAtomic !== "string" || !/^\d+$/.test(transfer.amountAtomic)) {
    fail(`${where}: amountAtomic is not an integer string`);
  } else {
    totalAtomic += BigInt(transfer.amountAtomic);
  }
  if (transfer.bucket === "external" && (!lastExternal || transfer.at > lastExternal.at)) lastExternal = transfer;
}
for (const bucket of ["ours", "external", "unknown"]) {
  if (snapshot.counts?.[bucket] !== counts[bucket]) fail(`counts.${bucket} ${snapshot.counts?.[bucket]} != ${counts[bucket]} rows`);
}
if (snapshot.counts?.transfers !== counts.ours + counts.external + counts.unknown) fail("counts do not sum to the row count");
if (snapshot.totals?.amountAtomic !== totalAtomic.toString()) fail(`totals.amountAtomic ${snapshot.totals?.amountAtomic} != ${totalAtomic}`);
if (lastExternal === null) {
  if (snapshot.lastExternal !== null) fail("snapshot lastExternal is not null, but no external transfer exists");
} else {
  const recorded = snapshot.lastExternal ?? {};
  if (recorded.date !== lastExternal.at.slice(0, 10)) fail(`lastExternal.date ${recorded.date} != newest external ${lastExternal.at.slice(0, 10)}`);
  if (recorded.tx !== lastExternal.tx) fail(`lastExternal.tx ${recorded.tx} != newest external ${lastExternal.tx}`);
}

if (!existsSync(PAGE)) fail("apps/console/src/app/pricing/page.tsx is missing");
else {
  const page = readFileSync(PAGE, "utf8");
  if (!page.includes("@/lib/payments-incoming")) fail("the pricing page does not import the classifier's snapshot module");
  if (!page.includes("formatSentence(INCOMING)")) fail("the pricing page does not format the sentence from INCOMING");
  if (/\b\d{1,3}(?:,\d{3})*\s+transfers to our payee\b/.test(page)) fail("the pricing page types a count into JSX instead of formatting the snapshot");
  if (!page.includes("tx_count")) fail("the pricing page does not carry the explorer tx_count caveat");
}

if (problems.length === 0) {
  console.log(
    `payments-incoming-check: clean — ${counts.ours} ours, ${counts.external} external, ${counts.unknown} unknown; ` +
      `last external ${snapshot.lastExternal?.date ?? "none"}`,
  );
  process.exit(0);
}
console.error(`payments-incoming-check: ${problems.length} problem(s):`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
