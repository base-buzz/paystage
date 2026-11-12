#!/usr/bin/env node
/**
 * first-user-check.mjs
 *
 * Reports today's unique *real* payer addresses from the public metrics
 * endpoint and compares them against an ops baseline.
 *
 *   node scripts/first-user-check.mjs           # compare, exit 1 on new payers
 *   node scripts/first-user-check.mjs --write   # also fold new payers in
 *
 * Node built-ins only (fetch, fs). No dependencies.
 *
 * STATUS 2026-11-12: this now works. The endpoint gained a `payer` field when the hosted
 * service started reading the settlement receipt (route `PAYMENT-RESPONSE`), so a real payer
 * address is finally recorded and exposed. Before that, the honest output was exit 2,
 * "cannot determine" — not "0 payers", which would have been a fake metric.
 *
 * The guard is kept, not deleted: if the field disappears again, this must fail loudly
 * rather than report a comfortable zero. A check that cannot tell "nobody paid" from "we
 * cannot see who paid" is worse than no check.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const METRICS_URL = "https://paystage.xyz/api/metrics";
const BASELINE_PATH = "/work/ops/docs/state/payers.baseline.json";

/**
 * Event fields that could carry an address, best-first. Only a genuine payer
 * field may be treated as a payer, so "pay_to" is deliberately NOT listed:
 * pay_to is who gets paid, not who paid. Counting it as a user would inflate
 * the user number.
 */
const PAYER_FIELDS = ["payer", "payer_address", "from", "from_address", "sender", "wallet", "address"];

/** Fields we recognise but refuse to count as payers, with the reason why. */
const NON_PAYER_FIELDS = { pay_to: "merchant receiving address, not the payer" };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const args = new Set(process.argv.slice(2));
const WRITE = args.has("--write");

function die(msg, code = 2) {
  console.error(`first-user-check: ${msg}`);
  process.exit(code);
}

/** Read the baseline, creating {"addresses": []} if the file is missing. */
function loadBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE_PATH, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") die(`cannot read baseline ${BASELINE_PATH}: ${err.message}`);
    try {
      mkdirSync(dirname(BASELINE_PATH), { recursive: true });
      writeFileSync(BASELINE_PATH, JSON.stringify({ addresses: [] }, null, 2) + "\n");
    } catch (werr) {
      die(`baseline missing and could not be created at ${BASELINE_PATH}: ${werr.message}`);
    }
    console.log(`baseline: created ${BASELINE_PATH} as {"addresses": []}`);
    return { addresses: [], created: true };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(`baseline ${BASELINE_PATH} is not valid JSON: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.addresses)) {
    die(`baseline ${BASELINE_PATH} must be an object with an "addresses" array`);
  }
  const bad = parsed.addresses.filter((a) => typeof a !== "string" || !ADDRESS_RE.test(a));
  if (bad.length) die(`baseline ${BASELINE_PATH} contains non-address entries: ${bad.slice(0, 3).join(", ")}`);
  return { addresses: parsed.addresses, created: false };
}

/** Today's UTC date as YYYY-MM-DD. */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** Pull the payer field an event actually carries, if any. */
function payerFieldOf(event) {
  for (const f of PAYER_FIELDS) {
    if (typeof event[f] === "string" && ADDRESS_RE.test(event[f])) return { field: f, value: event[f] };
  }
  return null;
}

async function main() {
  // 1. Fetch realCount24h plus the events list.
  let payload;
  try {
    const res = await fetch(METRICS_URL, { headers: { accept: "application/json" } });
    if (!res.ok) die(`metrics request failed: HTTP ${res.status} ${res.statusText}`, 2);
    payload = await res.json();
  } catch (err) {
    die(`could not fetch ${METRICS_URL}: ${err.message}`, 2);
  }

  const realCount24h = payload.realCount24h;
  const events = Array.isArray(payload.events) ? payload.events : null;
  if (events === null) die("metrics payload has no events array", 2);

  console.log(`metrics: fetched ${METRICS_URL}`);
  console.log(`realCount24h: ${realCount24h ?? "(absent)"}`);
  console.log(`events in payload: ${events.length}`);

  // 2. Real (non-synthetic, non-test) events from today, UTC.
  const today = todayUtc();
  const realToday = events.filter((e) => {
    const src = String(e.source ?? "").toLowerCase();
    if (src === "synthetic" || src === "test") return false;
    const ts = Date.parse(e.created_at);
    if (Number.isNaN(ts)) return false;
    return new Date(ts).toISOString().slice(0, 10) === today;
  });

  const sources = {};
  for (const e of events) {
    const s = String(e.source ?? "(none)").toLowerCase();
    sources[s] = (sources[s] ?? 0) + 1;
  }
  console.log(`event sources: ${JSON.stringify(sources)}`);
  console.log(`real events today (${today} UTC): ${realToday.length}`);

  // Honest-data guard: do we have an address field to work with at all?
  const seenFields = new Set();
  for (const e of events) for (const k of Object.keys(e)) seenFields.add(k);
  const payerField = PAYER_FIELDS.find((f) => seenFields.has(f));
  const nonPayerPresent = Object.keys(NON_PAYER_FIELDS).filter((f) => seenFields.has(f));

  if (!payerField) {
    console.error("");
    console.error(`first-user-check: CANNOT DETERMINE PAYERS -- the metrics payload exposes no payer address field.`);
    console.error(`  fields present: ${[...seenFields].sort().join(", ")}`);
    if (nonPayerPresent.length) {
      console.error(
        `  note: ${nonPayerPresent.map((f) => `${f} is present but is ${NON_PAYER_FIELDS[f]}`).join("; ")}`,
      );
    }
    console.error(
      `  looked for: ${PAYER_FIELDS.join(", ")}. Report this as a missing-data condition, not as "0 new payers".`,
    );
    process.exit(2);
  }

  // 3. Baseline (only after we know the payload can actually name payers).
  const baseline = loadBaseline();
  const baselineSet = new Set(baseline.addresses.map((a) => a.toLowerCase()));
  console.log(`baseline: ${baseline.addresses.length} address(es) at ${BASELINE_PATH}`);

  // 4. Unique payer addresses among today's real events.
  const payers = new Map(); // lowercase -> first-seen original casing
  for (const e of realToday) {
    const hit = payerFieldOf(e);
    if (hit) payers.set(hit.value.toLowerCase(), hit.value);
  }

  const uniques = [...payers.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  console.log(`unique real payer addresses today: ${uniques.length} (via "${payerField}")`);
  for (const a of uniques) console.log(`  ${a}`);

  const fresh = uniques.filter((a) => !baselineSet.has(a.toLowerCase()));

  console.log("");
  if (!fresh.length) {
    console.log(`no new payers vs baseline (${baseline.addresses.length} known).`);
  } else {
    console.log(`NEW payer address(es) not in baseline: ${fresh.length}`);
    for (const a of fresh) console.log(`  + ${a}`);
  }

  // 5. --write folds new addresses into the baseline.
  if (WRITE) {
    if (!fresh.length) {
      console.log(`--write: nothing to add, baseline unchanged.`);
    } else {
      const merged = [...new Set([...baseline.addresses, ...fresh])].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      );
      try {
        writeFileSync(BASELINE_PATH, JSON.stringify({ addresses: merged }, null, 2) + "\n");
      } catch (err) {
        die(`--write failed to update ${BASELINE_PATH}: ${err.message}`, 2);
      }
      console.log(`--write: baseline updated -> ${merged.length} address(es) at ${BASELINE_PATH}`);
    }
  } else if (fresh.length) {
    console.log(`(re-run with --write to record these in the baseline)`);
  }

  // Exit 1 if any address is new.
  process.exit(fresh.length ? 1 : 0);
}

main();
