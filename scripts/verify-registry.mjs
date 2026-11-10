#!/usr/bin/env node
/**
 * Re-verify every entry in the x402 registry.
 *
 * `verified_at` in `registry/services.json` is only worth the last time someone ran
 * this. A service that dies next week should not stay listed as live, and a one-off
 * manual check is not a property of the list — it is a memory of one afternoon.
 *
 * An entry passes when the endpoint answers `402` with an `accepts` entry that is:
 *
 *  - on the network the registry claims (`eip155:8453`)
 *  - paying the same `payTo` the registry records
 *  - priced at the same amount
 *
 * Requiring all three catches the failure that matters most: a seller who changed
 * their payout address and left a stale listing pointing at the old one. That is
 * exactly the shape of a listing you must not send an agent to.
 *
 * Read-only: it sends no payment, and a 402 is the success case.
 *
 *   node scripts/verify-registry.mjs            # human-readable
 *   node scripts/verify-registry.mjs --json     # machine-readable
 *   node scripts/verify-registry.mjs --write    # refresh verified_at for live entries
 *
 * Exit codes: 0 all live · 1 at least one dead · 2 the registry could not be read.
 */

import { readFile, writeFile } from "node:fs/promises";

const REGISTRY = new URL("../registry/services.json", import.meta.url);
const TIMEOUT_MS = 12_000;

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const write = args.has("--write");

function amountToHuman(amount, decimals) {
  const n = Number(amount) / 10 ** decimals;
  return Number.isFinite(n) ? n.toString() : amount;
}

function sameAddress(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

async function probeEntry(entry) {
  const started = Date.now();
  try {
    // Some endpoints are POST-only. A bare GET against ours returns 404, which would
    // read as "dead" — a probe that misreports a healthy entry is worse than none.
    const method = entry.method ?? "GET";
    const res = await fetch(entry.url, {
      method,
      headers: { accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST"
        ? { body: JSON.stringify({ payment_required: { x402Version: 2, accepts: [] }, policy: {} }) }
        : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const text = await res.text();

    if (res.status !== 402) {
      return { url: entry.url, ok: false, ms, status: res.status, reason: `expected 402, got ${res.status}` };
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { url: entry.url, ok: false, ms, status: 402, reason: "402 body is not JSON" };
    }

    // x402 v2 may carry the challenge in the `PAYMENT-REQUIRED` header (base64 JSON)
    // rather than the body. Our own endpoint does exactly that, so a body-only probe
    // reports a healthy entry as dead.
    let accepts = Array.isArray(body.accepts) ? body.accepts : [];
    if (accepts.length === 0) {
      const header = res.headers.get("payment-required");
      if (header !== null) {
        for (const decode of [() => Buffer.from(header, "base64").toString("utf8"), () => header]) {
          try {
            const parsed = JSON.parse(decode());
            if (Array.isArray(parsed?.accepts) && parsed.accepts.length > 0) {
              accepts = parsed.accepts;
              break;
            }
          } catch {
            // try the next decoding
          }
        }
      }
    }
    const match = accepts.find((a) => a?.network === entry.network);
    if (match === undefined) {
      const networks = accepts.map((a) => a?.network).filter(Boolean).join(", ") || "none";
      return {
        url: entry.url,
        ok: false,
        ms,
        status: 402,
        reason: `no accepts on ${entry.network} (offered: ${networks})`,
      };
    }

    if (!sameAddress(match.payTo, entry.payTo)) {
      return {
        url: entry.url,
        ok: false,
        ms,
        status: 402,
        reason: `payTo changed: registry ${entry.payTo}, live ${match.payTo}`,
      };
    }

    const livePrice = amountToHuman(match.amount, 6);
    const claimedPrice = String(entry.price).split(" ")[0];
    if (claimedPriceIsStale(claimedPrice, livePrice)) {
      return {
        url: entry.url,
        ok: false,
        ms,
        status: 402,
        reason: `price differs: registry ${entry.price}, live ${livePrice} USDC`,
      };
    }

    return { url: entry.url, ok: true, ms, status: 402, price: `${livePrice} USDC` };
  } catch (error) {
    return {
      url: entry.url,
      ok: false,
      ms: Date.now() - started,
      status: null,
      reason: error instanceof Error ? error.name : "error",
    };
  }
}

/** Prices move; a change is a warning, not a takedown. Reported, not failed. */
function claimedPriceIsStale(claimed, live) {
  const a = Number(claimed.replace(/[^0-9.]/g, ""));
  const b = Number(live);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) > 1e-9;
}

let entries;
try {
  entries = JSON.parse(await readFile(REGISTRY, "utf8"));
} catch (error) {
  process.stderr.write(
    `verify-registry: cannot read registry: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

const results = [];
for (const entry of entries) results.push({ name: entry.name, ...(await probeEntry(entry)) });

const dead = results.filter((r) => !r.ok);
const summary = {
  checked_at: new Date().toISOString(),
  total: results.length,
  live: results.length - dead.length,
  dead: dead.length,
  entries: results,
};

if (write) {
  const today = new Date().toISOString().slice(0, 10);
  const liveUrls = new Set(results.filter((r) => r.ok).map((r) => r.url));
  for (const entry of entries) if (liveUrls.has(entry.url)) entry.verified_at = today;
  await writeFile(REGISTRY, `${JSON.stringify(entries, null, 2)}\n`);
  summary.updated = true;
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  for (const r of results) {
    const mark = r.ok ? "ok  " : "DEAD";
    process.stdout.write(
      `${mark} ${r.name.padEnd(34)} ${String(r.status ?? "-").padStart(4)} ${String(r.ms).padStart(5)}ms  ${r.ok ? r.price : r.reason}\n`,
    );
  }
  process.stdout.write(`\n${summary.live}/${summary.total} live${write ? " · verified_at refreshed" : ""}\n`);
}

process.exit(dead.length === 0 ? 0 : 1);
