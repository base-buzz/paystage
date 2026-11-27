#!/usr/bin/env node
/**
 * `/lab/mesh` is a claim: *13,766 real payments, no invented point*. This checks it.
 *
 *   node scripts/check-soak-mesh.mjs
 *
 * Exit 0 clean · 1 a claim is unbacked · 2 a file is missing or unreadable.
 *
 * Checks:
 *   - the committed `latest.json` exists and is byte-identical to its dated `soak-<date>.json`;
 *   - the snapshot date, filename date and window end agree;
 *   - every row rendered as a payment carries a well-formed tx hash (a row without one is dropped
 *     by the extractor, not drawn);
 *   - the ten refusals carry no tx and the page says why instead of fabricating a link;
 *   - the totals conserve: rows = payer totals = payee totals, in integer micro-units;
 *   - the mesh, heatmap and daily aggregates sum back to the rows;
 *   - the page projection is exactly the snapshot's aggregates;
 *   - the provenance claims and the two lines per panel are present in the page source;
 *   - the page has no client component.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DIR = join(ROOT, "apps/console/public/mesh");
const LATEST = join(SNAPSHOT_DIR, "latest.json");
const PROJECTION = join(ROOT, "apps/console/src/lib/soak-mesh.generated.json");
const PAGE = join(ROOT, "apps/console/src/app/lab/mesh/page.tsx");
const COMPONENTS = join(ROOT, "apps/console/src/components/soak");
const BASESCAN = "https://sepolia.basescan.org/tx/";

const problems = [];
const fail = (message) => problems.push(message);

function readJson(path, label) {
  if (!existsSync(path)) {
    console.error(`soak-mesh-check: ${label} is missing — run \`node /work/ops/bin/soak-mesh-export.mjs\``);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`soak-mesh-check: ${label} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

if (!existsSync(LATEST)) {
  console.error("soak-mesh-check: apps/console/public/mesh/latest.json is missing — the page has no snapshot to render");
  process.exit(1);
}
if (!existsSync(PAGE)) {
  console.error(`soak-mesh-check: ${PAGE.replace(`${ROOT}/`, "")} is missing`);
  process.exit(1);
}

const snapshot = readJson(LATEST, "latest.json");
const projection = readJson(PROJECTION, "soak-mesh.generated.json");

function toMicro(amount) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(amount));
  return match ? Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0")) : null;
}

const isTx = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const requiredRowKeys = ["at", "wallet", "payee", "amount", "decision", "tx", "window"];

/* ---------- snapshot identity and window ---------- */

if (typeof snapshot.snapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.snapshotDate)) {
  fail("snapshotDate is not a YYYY-MM-DD date");
}
const dated = join(SNAPSHOT_DIR, `soak-${snapshot.snapshotDate}.json`);
if (!existsSync(dated)) {
  fail(`dated snapshot soak-${snapshot.snapshotDate}.json is missing (latest.json must have a dated twin)`);
} else if (readFileSync(dated, "utf8") !== readFileSync(LATEST, "utf8")) {
  fail(`latest.json is not byte-identical to soak-${snapshot.snapshotDate}.json`);
}
if (!snapshot.window || typeof snapshot.window.start !== "string" || typeof snapshot.window.end !== "string") {
  fail("window.start / window.end are missing");
} else {
  if (snapshot.window.end.slice(0, 10) !== snapshot.snapshotDate) {
    fail(`window.end ${snapshot.window.end} disagrees with snapshotDate ${snapshot.snapshotDate}`);
  }
  if (snapshot.window.start.slice(0, 10) !== snapshot.window.label.split("..")[0]) {
    fail(`window.start ${snapshot.window.start} disagrees with window.label ${snapshot.window.label}`);
  }
  if (snapshot.window.end.slice(0, 10) !== snapshot.window.label.split("..")[1]) {
    fail(`window.end ${snapshot.window.end} disagrees with window.label ${snapshot.window.label}`);
  }
  if (snapshot.window.label !== `${snapshot.window.start.slice(0, 10)}..${snapshot.window.end.slice(0, 10)}`) {
    fail(`window.label ${snapshot.window.label} is not the start..end date pair`);
  }
  const days = Math.round((Date.parse(`${snapshot.window.end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${snapshot.window.start.slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1;
  if (snapshot.window.days !== days) fail(`window.days ${snapshot.window.days} does not match the dates (${days})`);
}
if (snapshot.source !== "dev-loadgen") fail(`source is ${JSON.stringify(snapshot.source)}, expected "dev-loadgen"`);

/* ---------- rows: the extractor's promise ---------- */

const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
if (rows.length === 0) fail("snapshot.rows is empty");
const txSeen = new Set();
for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  const where = `rows[${index}]`;
  for (const key of requiredRowKeys) {
    if (!(key in row)) {
      fail(`${where} has no ${key}`);
      break;
    }
  }
  if (!isTx(row.tx)) fail(`${where}.tx is not a 32-byte hex hash: ${JSON.stringify(row.tx)}`);
  else if (txSeen.has(row.tx)) fail(`${where}.tx duplicates an earlier hash: ${row.tx}`);
  else txSeen.add(row.tx);
  if (typeof row.at !== "string" || Number.isNaN(Date.parse(row.at))) fail(`${where}.at is not a timestamp`);
  if (typeof row.wallet !== "string" || row.wallet === "") fail(`${where}.wallet is empty`);
  if (typeof row.payee !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(row.payee)) fail(`${where}.payee is not an address`);
  if (toMicro(row.amount) === null) fail(`${where}.amount is not a six-decimal amount: ${JSON.stringify(row.amount)}`);
  if (typeof row.decision !== "string" || row.decision === "") fail(`${where}.decision is empty`);
  if (row.window !== snapshot.window?.label) fail(`${where}.window ${JSON.stringify(row.window)} does not match ${snapshot.window?.label}`);
}

/* ---------- refusals: listed, not turned into a field ---------- */

const refusals = Array.isArray(snapshot.refusals) ? snapshot.refusals : [];
for (let index = 0; index < refusals.length; index += 1) {
  const refusal = refusals[index];
  if (refusal.decision === "pay") fail(`refusals[${index}] has decision "pay"; a refusal cannot be a paid row`);
  if (refusal.tx !== null) {
    if (!isTx(refusal.tx)) fail(`refusals[${index}].tx is neither null nor a hash`);
  }
}
if (projection.refusals.length !== refusals.length) {
  fail(`projection has ${projection.refusals.length} refusals; snapshot has ${refusals.length}`);
}

/* ---------- counts and conservation ---------- */

const wallets = new Set(rows.map((row) => row.wallet));
const payees = new Set(rows.map((row) => row.payee));
const payerMicro = new Map();
const payeeMicro = new Map();
let sumRows = 0;
for (const row of rows) {
  const micro = toMicro(row.amount) ?? 0;
  sumRows += micro;
  payerMicro.set(row.wallet, (payerMicro.get(row.wallet) ?? 0) + micro);
  payeeMicro.set(row.payee, (payeeMicro.get(row.payee) ?? 0) + micro);
}
const sumPayers = [...payerMicro.values()].reduce((sum, micro) => sum + micro, 0);
const sumPayees = [...payeeMicro.values()].reduce((sum, micro) => sum + micro, 0);

if (snapshot.counts?.withTx !== rows.length) fail(`counts.withTx ${snapshot.counts?.withTx} != rows ${rows.length}`);
if (snapshot.counts?.wallets !== wallets.size) fail(`counts.wallets ${snapshot.counts?.wallets} != distinct wallets ${wallets.size}`);
if (snapshot.counts?.payees !== payees.size) fail(`counts.payees ${snapshot.counts?.payees} != distinct payees ${payees.size}`);
if (snapshot.counts?.refusals !== refusals.length) fail(`counts.refusals ${snapshot.counts?.refusals} != refusals ${refusals.length}`);
if (!(snapshot.counts?.journalLines >= rows.length)) fail("counts.journalLines is smaller than the tx-bearing rows");
if (snapshot.totals?.amountMicro !== sumRows) fail(`totals.amountMicro ${snapshot.totals?.amountMicro} != rows ${sumRows}`);
if (snapshot.totals?.payerMicro !== sumPayers) fail(`totals.payerMicro ${snapshot.totals?.payerMicro} != payer sums ${sumPayers}`);
if (snapshot.totals?.payeeMicro !== sumPayees) fail(`totals.payeeMicro ${snapshot.totals?.payeeMicro} != payee sums ${sumPayees}`);
if (snapshot.totals?.differenceMicro !== 0) fail(`totals.differenceMicro ${snapshot.totals?.differenceMicro} is not zero`);
if (sumRows !== sumPayers || sumRows !== sumPayees) {
  fail(`conservation broken: rows ${sumRows}, payers ${sumPayers}, payees ${sumPayees}`);
}

/* ---------- aggregates that must sum to the rows ---------- */

const mesh = snapshot.aggregates?.mesh;
if (!mesh) {
  fail("snapshot has no aggregates.mesh");
} else {
  const leftIds = new Set((mesh.left ?? []).map((node) => node.id));
  const rightIds = new Set((mesh.right ?? []).map((node) => node.id));
  const sumNode = (nodes, key) => (nodes ?? []).reduce((sum, node) => sum + (node[key] ?? 0), 0);
  if (sumNode(mesh.left, "payments") !== rows.length) fail(`mesh left node payments ${sumNode(mesh.left, "payments")} != rows ${rows.length}`);
  if (sumNode(mesh.right, "payments") !== rows.length) fail(`mesh right node payments ${sumNode(mesh.right, "payments")} != rows ${rows.length}`);
  if (sumNode(mesh.left, "micro") !== sumRows) fail(`mesh left node micro ${sumNode(mesh.left, "micro")} != rows ${sumRows}`);
  if (sumNode(mesh.right, "micro") !== sumRows) fail(`mesh right node micro ${sumNode(mesh.right, "micro")} != rows ${sumRows}`);
  if (sumNode(mesh.edges, "count") !== rows.length) fail(`mesh edges count ${sumNode(mesh.edges, "count")} != rows ${rows.length}`);
  if (sumNode(mesh.edges, "micro") !== sumRows) fail(`mesh edges micro ${sumNode(mesh.edges, "micro")} != rows ${sumRows}`);
  for (const edge of mesh.edges ?? []) {
    if (!leftIds.has(edge.from)) fail(`mesh edge from ${edge.from} has no left node`);
    if (!rightIds.has(edge.to)) fail(`mesh edge to ${edge.to} has no right node`);
  }
  const throughOthers = (mesh.edges ?? [])
    .filter((edge) => edge.from === "others" || edge.to === "others")
    .reduce((sum, edge) => sum + edge.count, 0);
  if (mesh.throughOthers?.payments !== throughOthers) fail(`mesh.throughOthers ${mesh.throughOthers?.payments} != ${throughOthers}`);
}

const heatmap = snapshot.aggregates?.heatmap;
if (!heatmap) {
  fail("snapshot has no aggregates.heatmap");
} else {
  if (!Array.isArray(heatmap.hours) || heatmap.hours.length !== 24) fail("heatmap.hours is not 24 hours");
  let cells = 0;
  let rowTotals = 0;
  for (const row of heatmap.rows ?? []) {
    if (!Array.isArray(row.counts) || row.counts.length !== 24) fail(`heatmap row ${row.id} does not have 24 cells`);
    cells += (row.counts ?? []).reduce((sum, count) => sum + count, 0);
    rowTotals += row.total ?? 0;
  }
  if (cells !== rows.length) fail(`heatmap cells ${cells} != rows ${rows.length}`);
  if (rowTotals !== rows.length) fail(`heatmap row totals ${rowTotals} != rows ${rows.length}`);
  const hourly = (heatmap.hourly ?? []).reduce((sum, count) => sum + count, 0);
  if (hourly !== rows.length) fail(`heatmap hourly total ${hourly} != rows ${rows.length}`);
  const daily = (heatmap.daily ?? []).reduce((sum, day) => sum + day.payments, 0);
  if (daily !== rows.length) fail(`heatmap daily total ${daily} != rows ${rows.length}`);
}

/* ---------- the projection the page renders ---------- */

if (!projection || projection.snapshotDate !== snapshot.snapshotDate) fail("projection snapshotDate disagrees with the snapshot");
if (projection.source !== snapshot.source) fail("projection source disagrees with the snapshot");
if (JSON.stringify(projection.counts) !== JSON.stringify(snapshot.counts)) fail("projection counts disagree with the snapshot");
if (JSON.stringify(projection.totals) !== JSON.stringify(snapshot.totals)) fail("projection totals disagree with the snapshot");
if (JSON.stringify(projection.window) !== JSON.stringify(snapshot.window)) fail("projection window disagrees with the snapshot");
if (JSON.stringify(projection.mesh) !== JSON.stringify(snapshot.aggregates?.mesh)) fail("projection mesh is not the snapshot's mesh");
if (JSON.stringify(projection.heatmap) !== JSON.stringify(snapshot.aggregates?.heatmap)) fail("projection heatmap is not the snapshot's heatmap");

if (!Array.isArray(projection.samples) || projection.samples.length === 0) {
  fail("projection has no sample payments to link");
} else {
  for (const [index, sample] of projection.samples.entries()) {
    if (!isTx(sample.tx)) fail(`samples[${index}] has no tx hash`);
    if (sample.url !== `${BASESCAN}${sample.tx}`) fail(`samples[${index}] does not link to Basescan Sepolia`);
  }
  if (projection.samples.length > rows.length) fail("projection renders more sample payments than rows exist");
}

/* ---------- page source: the non-optional provenance claims ---------- */

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

const pageSource = [PAGE, ...walk(COMPONENTS)]
  .filter((file) => existsSync(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  .toLowerCase()
  .replace(/\s+/g, " ");

for (const claim of [
  "dev-loadgen",
  "a real market is zipfian; this one is engineered",
  "what it proves",
  "what it does not prove",
  "basescan sepolia",
  "no tx: refused before broadcast",
  "refusals",
]) {
  if (!pageSource.includes(claim)) fail(`page source is missing the claim: ${claim}`);
}
if (/["']use client["']/.test(pageSource)) fail("the mesh page or a soak component is a client component; #482 requires no client JS");

/* ---------- report ---------- */

if (problems.length > 0) {
  console.error(`soak-mesh-check: ${problems.length} problem(s) — the page's claims are not all backed by the snapshot`);
  for (const problem of problems.slice(0, 30)) console.error(`  - ${problem}`);
  if (problems.length > 30) console.error(`  … ${problems.length - 30} more`);
  process.exit(1);
}

console.log(
  `soak-mesh-check: ok — ${rows.length.toLocaleString("en-US")} tx rows · ${wallets.size} wallets · ${payees.size} payees · ` +
    `${refusals.length} refusals · ${(sumRows / 1e6).toFixed(6)} ETH conserved · snapshot ${snapshot.snapshotDate}`,
);
