#!/usr/bin/env node
/**
 * The monthly refusal summary (#433): for one period, what did the mandate stop, and against which rule.
 *
 *   /work/ops/bin/with-secret supabase node scripts/refusal-summary.mjs --days 30 --json
 *   /work/ops/bin/with-secret supabase node scripts/refusal-summary.mjs --days 30 --policy <policy_sha256>
 *   /work/ops/bin/with-secret supabase node scripts/refusal-summary.mjs --days 30 \
 *     --example-out apps/console/src/lib/refusal-example.json
 *
 * The data is already stored. `evaluate` writes one `evidence_bundles` row per decision, with a
 * signed receipt on the hosted path, and the receipt carries `verdict.decision`, `verdict.reasons[0]`
 * (the rule that fired) and `payment {amount, payee, asset, network}`. This script reads that table
 * through `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — the same two variables `with-secret supabase`
 * exports — pages it, and never prints a number it could not read. No new store, no new table, no
 * migration.
 *
 * Honest limits, printed rather than smoothed over:
 *   * `review` is not a refusal. It is counted separately and never added to `refusals`.
 *   * A refusal whose stored bundle has no receipt is still a refusal (the bundle's own `decision`
 *     column is the record), but it may carry no payment terms. Those are counted in `refusals` and
 *     named in `without_payment`, and they are excluded from the money totals — a total that silently
 *     dropped them would understate the period in the direction that flatters the limit.
 *   * `by_rule` is `verdict.reasons[0]` verbatim: the evaluator's own sentence, never a category this
 *     script invented. A decision with no reasons is its own `unspecified` bucket.
 *   * `--serial` can only select a mandate if a stored record carries a mandate serial. No writer
 *     records one today (#423 `GET /v1/mandate/:serial` does not exist), so it exits 2 naming the
 *     missing field. `--policy <sha256>` selects the one mandate identity a receipt does carry.
 *   * Amounts are formatted with the decimals the policy declared for the payment's asset. If the
 *     refused rows span more than one asset, a single total would add unlike units, so it exits 2.
 *   * A payer address is never printed. A payee is the recipient named in the 402 terms, not the payer.
 *
 * Exit codes: 0 a report was produced (including an honest empty period) · 2 the source could not be
 * read, or a field needed for the period is absent. It never prints zeros as a substitute for a read
 * that failed.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
/** Bundle rows are written milliseconds after the decision; a small margin keeps a boundary row from being missed. */
const QUERY_MARGIN_MS = 5 * 60_000;

const DECISIONS = new Set(["pay", "review", "do_not_pay"]);
const UNSPECIFIED = "unspecified";

export class MissingField extends Error {
  constructor(field, detail) {
    super(`${field}${detail ? ` — ${detail}` : ""}`);
    this.name = "MissingField";
    this.field = field;
  }
}

export function parseArgs(argv) {
  const args = { days: 30, serial: null, policy: null, json: false, exampleOut: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new MissingField(flag, "expects a value");
      i += 1;
      return value;
    };
    if (flag === "--days") {
      const raw = next();
      const days = Number(raw);
      if (!Number.isFinite(days) || days <= 0) throw new MissingField("--days", `must be a positive number, got ${JSON.stringify(raw)}`);
      args.days = days;
    } else if (flag === "--serial") {
      args.serial = next();
    } else if (flag === "--policy") {
      args.policy = next().toLowerCase();
    } else if (flag === "--json") {
      args.json = true;
    } else if (flag === "--example-out") {
      args.exampleOut = next();
    } else if (flag === "--help" || flag === "-h") {
      args.help = true;
    } else {
      throw new MissingField(flag, "unknown flag; see --help");
    }
  }
  return args;
}

export function windowFor(now, days) {
  const to = new Date(now);
  const from = new Date(to.getTime() - days * 86_400_000);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) throw new MissingField("period", "now is not a valid date");
  return { from: from.toISOString(), to: to.toISOString() };
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return undefined;
  }
}

function pickArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : null;
}

function receiptOf(row) {
  return parseJson(row.receipt);
}

function proofOf(row) {
  return parseJson(row.proof);
}

function serialOf(receipt, proof) {
  const candidates = [
    receipt?.verdict?.mandate_serial,
    receipt?.payment?.mandate_serial,
    proof?.inputs?.options?.mandate_serial,
    proof?.inputs?.mandate_serial,
    proof?.inputs?.payment_required?.mandate_serial,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function decimalsFor(policy, payment) {
  if (payment === null || typeof payment.asset !== "string" || payment.asset === "") return null;
  const assets = Array.isArray(policy?.allowed_assets) ? policy.allowed_assets : [];
  const match = assets.find((asset) => {
    if (asset === null || typeof asset !== "object") return false;
    if (String(asset.address ?? "").toLowerCase() !== payment.asset.toLowerCase()) return false;
    if (asset.network !== undefined && payment.network !== undefined) {
      return String(asset.network).toLowerCase() === String(payment.network).toLowerCase();
    }
    return true;
  });
  if (match === undefined || !Number.isInteger(match.decimals) || match.decimals < 0 || match.decimals > 36) return null;
  return { decimals: match.decimals, symbol: typeof match.symbol === "string" && match.symbol !== "" ? match.symbol : null };
}

/**
 * One stored bundle -> the facts this report counts.
 *
 * The receipt is authoritative when present. A bundle with no receipt still records its own
 * `decision` and (for the MCP path) the evaluator's verdict in `proof`; that is a real refusal,
 * not a gap, so it is counted — but `hasReceipt: false` keeps the distinction visible.
 */
export function recordFromBundle(row) {
  if (row === null || typeof row !== "object") throw new MissingField("evidence_bundles row", "was not an object");
  const receipt = receiptOf(row);
  if (receipt === undefined) throw new MissingField("evidence_bundles.receipt", "is not valid JSON");
  const proof = proofOf(row);
  if (proof === undefined) throw new MissingField("evidence_bundles.proof", "is not valid JSON");

  const verdict = receipt?.verdict ?? proof?.verdict ?? null;
  const decision = verdict?.decision ?? row.decision;
  if (!DECISIONS.has(decision)) {
    throw new MissingField("evidence_bundles.decision", `is ${JSON.stringify(decision)} for bundle ${String(row.id ?? "?")}`);
  }

  const reasons = pickArray(receipt?.verdict?.reasons) ?? pickArray(proof?.verdict?.reasons) ?? [];
  const rule = reasons[0] ?? UNSPECIFIED;

  const receiptPayment = receipt?.payment;
  const accept = proof?.verdict?.selected_accept;
  const payment =
    receiptPayment !== null && typeof receiptPayment === "object"
      ? {
          amount: typeof receiptPayment.amount === "string" ? receiptPayment.amount : null,
          payee: typeof receiptPayment.payee === "string" ? receiptPayment.payee : null,
          asset: typeof receiptPayment.asset === "string" ? receiptPayment.asset : null,
          network: typeof receiptPayment.network === "string" ? receiptPayment.network : null,
        }
      : accept !== null && typeof accept === "object"
        ? {
            amount: typeof accept.amount === "string" ? accept.amount : null,
            payee: typeof accept.payTo === "string" ? accept.payTo : null,
            asset: typeof accept.asset === "string" ? accept.asset : null,
            network: typeof accept.network === "string" ? accept.network : null,
          }
        : null;

  const at =
    (typeof receipt?.issued_at === "string" && receipt.issued_at) ||
    (typeof proof?.inputs?.options?.now === "string" && proof.inputs.options.now) ||
    (typeof row.created_at === "string" && row.created_at) ||
    null;
  if (at === null || Number.isNaN(Date.parse(at))) {
    throw new MissingField("receipt.issued_at", `is absent or unreadable for bundle ${String(row.id ?? "?")}`);
  }

  const policy = proof?.inputs?.policy ?? null;
  const assetInfo = payment === null ? null : decimalsFor(policy, payment);
  const amountAtomic =
    payment !== null && typeof payment.amount === "string" && /^\d+$/.test(payment.amount) ? payment.amount : null;

  return {
    at,
    decision,
    rule,
    payee: payment?.payee ?? null,
    amountAtomic,
    asset: payment?.asset ?? null,
    assetSymbol: assetInfo?.symbol ?? null,
    decimals: assetInfo?.decimals ?? null,
    serial: serialOf(receipt, proof),
    policySha256:
      (typeof receipt?.policy_sha256 === "string" && receipt.policy_sha256) ||
      (typeof proof?.hashes?.policy_sha256 === "string" && proof.hashes.policy_sha256) ||
      null,
    hasReceipt: receipt !== null,
    hasPayment: payment !== null && amountAtomic !== null,
  };
}

export function formatAtomic(atomic, decimals) {
  const value = BigInt(atomic);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/** Exact median. An even count halves in atomic units, so it is formatted with one extra digit rather than rounded. */
export function medianAtomic(values, decimals) {
  if (values.length === 0) return null;
  const sorted = [...values].map((value) => BigInt(value)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return formatAtomic(sorted[middle], decimals);
  // (a + b) / 2 atomic = (a + b) * 5 / 10 atomic -> format at decimals + 1.
  return formatAtomic((sorted[middle - 1] + sorted[middle]) * 5n, decimals + 1);
}

function inWindow(record, fromMs, toMs) {
  const at = Date.parse(record.at);
  return at >= fromMs && at < toMs;
}

function countBy(records, key) {
  const map = new Map();
  for (const record of records) {
    const value = key(record);
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return map;
}

/**
 * The report for one window.
 *
 * `records` is the complete set read from the store (current + previous window); this function
 * partitions it by time, so the period boundary is one testable rule rather than a query side effect.
 */
export function summarize(records, { from, to }) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) {
    throw new MissingField("period", `from/to are not a valid window: ${JSON.stringify({ from, to })}`);
  }
  const spanMs = toMs - fromMs;
  const previousFromMs = fromMs - spanMs;

  const current = records.filter((record) => inWindow(record, fromMs, toMs));
  const previous = records.filter((record) => inWindow(record, previousFromMs, fromMs));

  const refusals = current.filter((record) => record.decision === "do_not_pay");
  const reviews = current.filter((record) => record.decision === "review").length;

  const byRule = [...countBy(refusals, (record) => record.rule).entries()]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));

  const amountRows = refusals.filter((record) => record.amountAtomic !== null);
  const withoutPayment = refusals.length - amountRows.length;
  const withoutReceipt = refusals.filter((record) => !record.hasReceipt).length;

  let decimals = null;
  let asset = null;
  let assetSymbol = null;
  for (const record of amountRows) {
    if (record.decimals === null) {
      throw new MissingField(
        "policy.allowed_assets[].decimals",
        `the policy stored with a ${record.decision} refusal does not declare decimals for ${String(record.asset)}`,
      );
    }
    if (decimals === null) {
      decimals = record.decimals;
      asset = record.asset;
      assetSymbol = record.assetSymbol;
    } else if (record.decimals !== decimals || String(record.asset).toLowerCase() !== String(asset).toLowerCase()) {
      throw new MissingField(
        "payment.asset",
        `refusals span more than one asset/decimals pair (${String(asset)}/${decimals} and ${String(record.asset)}/${record.decimals}); one total would add unlike units`,
      );
    }
  }

  const byPayeeMap = new Map();
  for (const record of refusals) {
    if (record.payee === null) continue;
    const entry = byPayeeMap.get(record.payee) ?? { payee: record.payee, count: 0, total: 0n };
    entry.count += 1;
    if (record.amountAtomic !== null) entry.total += BigInt(record.amountAtomic);
    byPayeeMap.set(record.payee, entry);
  }
  const byPayee = [...byPayeeMap.values()]
    .map((entry) => ({
      payee: entry.payee,
      count: entry.count,
      amount_total: decimals === null ? "0" : formatAtomic(entry.total, decimals),
    }))
    .sort((a, b) => b.count - a.count || a.payee.localeCompare(b.payee));

  const amounts =
    amountRows.length === 0
      ? { total: "0", median: null, asset: null }
      : {
          total: formatAtomic(
            amountRows.reduce((sum, record) => sum + BigInt(record.amountAtomic), 0n),
            decimals,
          ),
          median: medianAtomic(amountRows.map((record) => record.amountAtomic), decimals),
          asset: assetSymbol ?? asset,
        };

  const previousRefusals = previous.filter((record) => record.decision === "do_not_pay").length;
  const pct =
    previousRefusals === 0
      ? null
      : Math.round(((refusals.length - previousRefusals) / previousRefusals) * 1000) / 10;

  return {
    period: { from, to },
    refusals: refusals.length,
    reviews,
    by_rule: byRule,
    by_payee: byPayee,
    amounts,
    previous_period_delta: { refusals: previousRefusals, pct },
    without_payment: withoutPayment,
    without_receipt: withoutReceipt,
  };
}

export function redactSerial(serial) {
  if (typeof serial !== "string" || serial === "") return null;
  const tail = serial.slice(-3);
  return serial.startsWith("vch-") ? `vch-${tail}` : `…${tail}`;
}

function amountText(amount, asset) {
  return asset === null || asset === undefined || asset === "" ? amount : `${amount} ${asset}`;
}

export function humanLine(report, mandateLabel = "all mandates") {
  const topRule = report.by_rule[0];
  const delta =
    report.previous_period_delta.pct === null
      ? `previous ${report.previous_period_delta.refusals} (n/a)`
      : `previous ${report.previous_period_delta.refusals} (${report.previous_period_delta.pct > 0 ? "+" : ""}${report.previous_period_delta.pct}%)`;
  const money =
    report.amounts.median === null
      ? `no stored amount on ${report.without_payment} refusal(s)`
      : `${amountText(report.amounts.total, report.amounts.asset)} total, ${amountText(report.amounts.median, report.amounts.asset)} median`;
  const rule = topRule === undefined ? "no rule" : `${topRule.count}× ${topRule.rule}`;
  return (
    `refusal-summary ${report.period.from.slice(0, 10)}→${report.period.to.slice(0, 10)} (${mandateLabel}): ` +
    `${report.refusals} refusals · ${report.reviews} reviews · ${money}` +
    `${report.without_payment > 0 ? ` (${report.without_payment} without a stored payment)` : ""} · ` +
    `${delta} · top rule: ${rule}`
  );
}

function endpointBase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new MissingField(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      "is not set; run through /work/ops/bin/with-secret supabase so this script reads without printing a key",
    );
  }
  return { endpoint: `${url.replace(/\/+$/, "")}/rest/v1/evidence_bundles`, key };
}

/**
 * Read every bundle whose row could belong to the current or previous window.
 *
 * A partial page is not a count: if the window exceeds the page cap, this exits 2 rather than
 * reporting the first 50,000 rows as if they were the period.
 */
export async function readBundles({ from, to, fetchImpl = fetch }) {
  const { endpoint, key } = endpointBase();
  const queryFrom = new Date(Date.parse(from) - QUERY_MARGIN_MS).toISOString();
  const queryTo = new Date(Date.parse(to) + QUERY_MARGIN_MS).toISOString();
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `${endpoint}?select=id,decision,created_at,receipt,proof` +
      `&created_at=gte.${encodeURIComponent(queryFrom)}&created_at=lt.${encodeURIComponent(queryTo)}` +
      `&order=created_at.asc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
    } catch (error) {
      throw new MissingField("evidence_bundles", `could not be reached (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!response.ok) {
      // Status only: a PostgREST body can echo a caller's policy terms.
      throw new MissingField("evidence_bundles", `read failed with HTTP ${response.status}`);
    }
    let batch;
    try {
      batch = await response.json();
    } catch {
      throw new MissingField("evidence_bundles", "returned a body that is not JSON");
    }
    if (!Array.isArray(batch)) throw new MissingField("evidence_bundles", "returned an unexpected shape");
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw new MissingField(
    "evidence_bundles window",
    `exceeds ${MAX_PAGES * PAGE_SIZE} rows; a partial count is not a count — narrow the period`,
  );
}

function selectMandate(records, args) {
  let selected = records;
  if (args.serial !== null) {
    const carrying = selected.filter((record) => record.serial !== null);
    const matching = carrying.filter((record) => record.serial === args.serial);
    if (carrying.length === 0) {
      throw new MissingField(
        "mandate_serial",
        "is absent from every stored receipt and evidence bundle in this window, so --serial cannot select a mandate; " +
          "no writer records one (#423 GET /v1/mandate/:serial does not exist). The stable mandate identity a receipt does carry is policy_sha256 — use --policy <sha256>",
      );
    }
    if (matching.length === 0) {
      throw new MissingField("mandate_serial", `no stored record in this window carries ${JSON.stringify(args.serial)}`);
    }
    selected = matching;
  }
  if (args.policy !== null) {
    if (args.policy.length < 8) throw new MissingField("--policy", "needs at least 8 hex characters of the receipt's policy_sha256");
    const matches = selected.filter(
      (record) => record.policySha256 !== null && record.policySha256.toLowerCase().startsWith(args.policy),
    );
    if (matches.length === 0) {
      throw new MissingField("policy_sha256", `no stored receipt in this window matches ${JSON.stringify(args.policy)}`);
    }
    const distinct = new Set(matches.map((record) => record.policySha256));
    if (distinct.size > 1) {
      throw new MissingField("policy_sha256", `${JSON.stringify(args.policy)} is ambiguous across ${distinct.size} policies`);
    }
    selected = matches;
  }
  return selected;
}

function writeExample(records, report, outputPath) {
  const fromMs = Date.parse(report.period.from);
  const toMs = Date.parse(report.period.to);
  const refusals = records.filter((record) => record.decision === "do_not_pay" && inWindow(record, fromMs, toMs));
  const candidates = refusals
    .filter(
      (record) =>
        record.rule !== UNSPECIFIED &&
        record.amountAtomic !== null &&
        record.decimals !== null &&
        record.payee !== null,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const example = candidates[0];
  if (example === undefined) {
    throw new MissingField(
      "do_not_pay example",
      "no refusal in this period has a rule, a payable amount and a payee; refusing to invent one",
    );
  }
  const payload = {
    serial: redactSerial(example.serial),
    decision: "do_not_pay",
    rule: example.rule,
    amount: amountText(formatAtomic(example.amountAtomic, example.decimals), example.assetSymbol ?? example.asset),
    payee: example.payee,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

const USAGE = `refusal-summary (#433) — one period, one mandate, from stored receipts

  node scripts/refusal-summary.mjs --days 30
  node scripts/refusal-summary.mjs --days 30 --json
  node scripts/refusal-summary.mjs --days 30 --policy <policy_sha256>
  node scripts/refusal-summary.mjs --days 30 --serial <serial>   # needs a stored mandate serial
  node scripts/refusal-summary.mjs --days 30 --example-out apps/console/src/lib/refusal-example.json

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (exported by /work/ops/bin/with-secret supabase).
Exit 0 a report was produced · 2 the source or a required field could not be read. Never prints zeros
for a failed read.`;

export async function main(argv = process.argv.slice(2), { now = new Date(), fetchImpl = fetch } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const { from, to } = windowFor(now, args.days);
  const all = await readBundles({ from: previousFrom(from, to), to, fetchImpl });
  const records = all.map(recordFromBundle);
  const selected = selectMandate(records, args);
  const report = summarize(selected, { from, to });

  let mandateLabel = "all mandates";
  if (args.serial !== null) mandateLabel = `serial ${redactSerial(args.serial)}`;
  else if (args.policy !== null) mandateLabel = `policy ${args.policy.slice(0, 12)}…`;

  if (args.exampleOut !== null) {
    writeExample(selected, report, args.exampleOut);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
    console.log(humanLine(report, mandateLabel));
  }
  return 0;
}

function previousFrom(from, to) {
  const span = Date.parse(to) - Date.parse(from);
  return new Date(Date.parse(from) - span).toISOString();
}

function isMain() {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof MissingField) console.error(`refusal-summary: cannot read ${message}`);
      else console.error(`refusal-summary: ${message}`);
      console.error(
        "refusal-summary: no fabricated number and no zeros. Run through /work/ops/bin/with-secret supabase and check the field named above.",
      );
      process.exit(2);
    },
  );
}
