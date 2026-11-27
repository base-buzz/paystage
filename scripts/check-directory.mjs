#!/usr/bin/env node
/**
 * The directory's honesty gate (#497).
 *
 * This is the check the page's claims are load-bearing on, so it tests the claims rather than the file:
 *
 *   1. every row is dated and sourced — no row may borrow the run's date or an empty `verifiedSource`;
 *   2. `/directory.json` and `/directory` are the same data — both must import `@/lib/directory`, and that module must
 *      read the committed snapshot, so a second copy cannot appear in either place;
 *   3. a demand figure is only allowed with `source: "x402scan"` and a `capturedOn` date; a row without one must carry
 *      `null`, which the page renders as `not known`;
 *   4. the counts, categories and stated order agree with the rows.
 *
 * It runs in `scripts/ci-local.mjs` before the build, so a hand-edited snapshot or a page that stopped agreeing with
 * the JSON is red here rather than on the runner.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "apps/console/src/lib/directory.generated.json");
const LIB = join(ROOT, "apps/console/src/lib/directory.ts");
const PAGE = join(ROOT, "apps/console/src/app/directory/page.tsx");
const ROUTE = join(ROOT, "apps/console/src/app/directory.json/route.ts");

const failures = [];
const fail = (message) => failures.push(message);
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const isHttp = (value) => typeof value === "string" && /^https:\/\/\S+$/.test(value);

function read(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing at ${path}`);
    return "";
  }
  return readFileSync(path, "utf8");
}

const raw = read(SNAPSHOT, "directory snapshot");
let data = null;
if (raw) {
  try {
    data = JSON.parse(raw);
  } catch (error) {
    fail(`directory snapshot is not JSON: ${error.message}`);
  }
}

if (data) {
  if (data.schema !== "x402-merchant-directory/v1") fail(`schema is "${data.schema}", expected x402-merchant-directory/v1`);
  if (!Array.isArray(data.rows) || data.rows.length === 0) fail("directory has no rows");
  if (!Array.isArray(data.taxonomy) || data.taxonomy.length === 0) fail("directory has no taxonomy");
  if (!isDate(data.firstVerifiedOn) || !isDate(data.verifiedOn)) fail("the snapshot has no readable first/last verified date");
  if (data.firstVerifiedOn > data.verifiedOn) fail("firstVerifiedOn is after verifiedOn");

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const seen = new Set();
  let previousPrice = -1;
  for (const [index, row] of rows.entries()) {
    const where = `row ${index + 1} (${row.host ?? "no host"})`;
    if (typeof row.host !== "string" || row.host.trim() === "") fail(`${where}: no host`);
    if (!isHttp(row.resource)) fail(`${where}: resource is not an https URL`);
    if (typeof row.verifiedSource !== "string" || row.verifiedSource.trim() === "") fail(`${where}: no source`);
    if (!isDate(row.firstVerifiedOn)) fail(`${where}: no usable firstVerifiedOn`);
    if (!isDate(row.lastVerifiedOn)) fail(`${where}: no usable lastVerifiedOn`);
    if (isDate(row.firstVerifiedOn) && isDate(row.lastVerifiedOn) && row.firstVerifiedOn > row.lastVerifiedOn) {
      fail(`${where}: firstVerifiedOn is after lastVerifiedOn`);
    }
    if (Number.isFinite(previousPrice) && row.priceUsd < previousPrice) fail(`${where}: rows are not in ascending price order`);
    previousPrice = row.priceUsd;
    if (!Number.isFinite(row.priceUsd) || row.priceUsd < 0) fail(`${where}: priceUsd is not a finite non-negative number`);
    if (row.priceUnit !== "request") fail(`${where}: price unit is "${row.priceUnit}", expected "request"`);
    if (typeof row.method !== "string" || !["GET", "POST"].includes(row.method)) fail(`${where}: method is not GET or POST`);
    if (typeof row.chain !== "string" || row.chain.trim() === "") fail(`${where}: no chain`);
    if (!Number.isFinite(row.challengeBytes) || row.challengeBytes <= 0) fail(`${where}: no measured challenge size`);
    if (typeof row.category !== "string") fail(`${where}: no category`);

    if (seen.has(row.resource)) fail(`${where}: duplicate resource ${row.resource}`);
    seen.add(row.resource);

    if (row.x402scan !== null) {
      const demand = row.x402scan;
      if (!demand || typeof demand !== "object") {
        fail(`${where}: demand is neither null nor an object`);
        continue;
      }
      if (demand.source !== "x402scan") fail(`${where}: demand has no x402scan source`);
      if (!isDate(demand.capturedOn)) fail(`${where}: demand has no capturedOn date`);
      if (typeof demand.url !== "string" || !demand.url.startsWith("https://www.x402scan.com/recipient/")) {
        fail(`${where}: demand does not link to the x402scan recipient`);
      }
      if (!Number.isFinite(demand.payments) || demand.payments <= 0) fail(`${where}: demand payments is not a positive count`);
      if (!Number.isFinite(demand.valueUsd) || demand.valueUsd < 0) fail(`${where}: demand value is not a non-negative number`);
    }
  }

  const categories = new Set((data.taxonomy ?? []).map((entry) => entry.id));
  for (const row of rows) if (!categories.has(row.category)) fail(`row ${row.host}: category "${row.category}" is not in the taxonomy`);

  const byCategory = Object.fromEntries((data.taxonomy ?? []).map((entry) => [entry.id, 0]));
  for (const row of rows) byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  for (const entry of data.taxonomy ?? []) {
    if (entry.count !== byCategory[entry.id]) fail(`category ${entry.id} says ${entry.count}, rows say ${byCategory[entry.id]}`);
  }
  const withDemand = rows.filter((row) => row.x402scan !== null).length;
  if (data.counts?.resources !== rows.length) fail(`counts.resources is ${data.counts?.resources}, rows are ${rows.length}`);
  if (data.counts?.withDemand !== withDemand) fail(`counts.withDemand is ${data.counts?.withDemand}, rows are ${withDemand}`);
  if (data.counts?.withoutDemand !== rows.length - withDemand) {
    fail(`counts.withoutDemand is ${data.counts?.withoutDemand}, rows are ${rows.length - withDemand}`);
  }
  for (const [id, count] of Object.entries(byCategory)) {
    if (data.counts?.byCategory?.[id] !== count) fail(`counts.byCategory.${id} is ${data.counts?.byCategory?.[id]}, rows are ${count}`);
  }
  if (!Number.isFinite(data.counts?.hosts) || data.counts.hosts !== new Set(rows.map((row) => row.host)).size) {
    fail("counts.hosts does not match the distinct hosts in the rows");
  }
  if (data.ordering?.by !== "priceUsd" || data.ordering?.direction !== "ascending") {
    fail("the snapshot does not state a price-ascending order");
  }
}

/**
 * The page and the endpoint must read the same module, and that module must read the committed snapshot. This is
 * what makes "the page agrees with the JSON" structural rather than a promise in a comment.
 */
const lib = read(LIB, "directory module");
const page = read(PAGE, "directory page");
const route = read(ROUTE, "directory.json route");
if (lib && !/directory\.generated\.json/.test(lib)) fail("src/lib/directory.ts does not import the generated snapshot");
if (page && !/from "@\/lib\/directory"/.test(page)) fail("the page does not import @/lib/directory");
if (page && !/directoryView/.test(page)) fail("the page does not render directoryView()");
if (page && !/LISTING_MEANING/.test(page)) fail("the page does not carry the 'answered a challenge, not a payment' line");
if (page && !/not known/.test(page)) fail("the page does not say 'not known' for a missing demand figure");
if (page && !/ORDER_EXPLANATION/.test(page)) fail("the page does not state the order");
if (route && !/from "@\/lib\/directory"/.test(route)) fail("the JSON endpoint does not import @/lib/directory");
if (route && !/directoryPayload/.test(route)) fail("the JSON endpoint does not serve directoryPayload()");

if (failures.length > 0) {
  console.error("check-directory: FAIL");
  for (const message of failures.slice(0, 20)) console.error(`  - ${message}`);
  if (failures.length > 20) console.error(`  … and ${failures.length - 20} more`);
  process.exit(1);
}

console.log(
  `check-directory: ok — ${data.rows.length} rows, ${data.counts.withDemand} with x402scan demand (${data.source?.demand?.capturedOn}), ${data.counts.withoutDemand} not known; page and JSON read the same snapshot`,
);
