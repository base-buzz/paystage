#!/usr/bin/env node
/**
 * The weekly line the 90-day test promises (#430): non-own callers of the gate, repeat callers among them, and the
 * gap to zero.
 *
 *   /work/ops/bin/with-secret supabase node scripts/caller-provenance-report.mjs
 *   /work/ops/bin/with-secret supabase node scripts/caller-provenance-report.mjs --days 90
 *
 * Reads the events table through the same path the ops scripts use: `with-secret supabase` exports
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which this script reads and never prints. No new credential path.
 *
 * Deterministic and honest about what it cannot see:
 *   * `unknown` is NOT "external". It is the absence of a signed `x-paystage-provenance` label, which includes our
 *     own callers before they sign. The line prints it as its own bucket and calls the non-own count "unknown
 *     provenance", never "external".
 *   * A "caller" is a distinct `payer` address on a settlement (the only caller identity this project records; IPs
 *     and user agents are deliberately never collected). Requests without a payer cannot be counted as callers and
 *     are reported separately, not dropped.
 *   * "Repeat" means the same non-own payer on two or more distinct UTC days, not two events in one session.
 *   * "Gap to zero" is the number of additional distinct non-own callers needed for the count to leave zero: 1 while
 *     it is 0, 0 once it is above zero.
 *
 * Exit codes: 0 the line printed real counts · 1 the source could not be read (the line then prints `unknown` for all
 * three numbers instead of inventing one). It never prints a number it did not read.
 */

const SUPABASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const daysFlag = args.indexOf("--days");
const days = daysFlag >= 0 ? Number(args[daysFlag + 1]) : 7;

/** How many pages of 1000 to read before calling the window unreadable rather than printing a partial count. */
const MAX_PAGES = 50;
const PAGE_SIZE = 1000;

function line(parts) {
  console.log(parts.join(" · "));
}

function cannotRead(reason) {
  line([
    `caller-provenance (last ${days}d): could not read the events source (${reason})`,
    "non-own callers=unknown",
    "repeat callers among them=unknown",
    "gap to zero=unknown",
  ]);
  console.error(
    "caller-provenance: no fabricated number. Run through /work/ops/bin/with-secret supabase … and apply the caller_provenance migration.",
  );
  process.exit(1);
}

if (!SUPABASE || !KEY) {
  cannotRead("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
}

if (!Number.isFinite(days) || days <= 0) {
  cannotRead(`--days must be a positive number, got ${String(args[daysFlag + 1])}`);
}

const since = new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const endpoint = `${SUPABASE.replace(/\/+$/, "")}/rest/v1/events`;

async function readWindow() {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${endpoint}?select=caller_provenance,payer,ts` +
      `&ts=gte.${encodeURIComponent(since)}&order=ts.asc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          Accept: "application/json",
        },
      });
    } catch (error) {
      return { error: `network: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // The column this report is about does not exist yet. Say which migration is missing, never guess.
      if (/caller_provenance|PGRST204/i.test(body)) {
        return { error: "events.caller_provenance is not in the table — migration 20261125120000 is not applied" };
      }
      return { error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const pageRows = await res.json();
    if (!Array.isArray(pageRows)) return { error: "unexpected response shape" };
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return { rows };
  }
  return { error: `window exceeds ${MAX_PAGES * PAGE_SIZE} rows; a partial count is not a count` };
}

const read = await readWindow();
if (read.error !== undefined) cannotRead(read.error);

const own = new Set(["own-ci", "own-loadgen", "own-probe"]);
const nonOwn = new Map(); // payer -> Set(day)
let ownEvents = 0;
let unknownEvents = 0;
let preInstrumentationEvents = 0;
let unknownWithoutPayer = 0;

for (const row of read.rows) {
  const provenance = String(row.caller_provenance ?? "unknown");
  if (own.has(provenance)) {
    ownEvents += 1;
    continue;
  }
  /**
   * Rows written before the column existed are a different fact from "a caller who did not sign": they were never
   * asked. Counting them together would make the pre-instrumentation month look like unlabelled adoption, so they
   * are counted, labelled and printed apart — and the day-90 comparison can exclude them by name.
   */
  if (provenance === "unknown-provenance") {
    preInstrumentationEvents += 1;
    continue;
  }
  // Anything else not proven ours is `unknown` provenance, not "external".
  unknownEvents += 1;
  const payer = typeof row.payer === "string" && row.payer !== "" ? row.payer.toLowerCase() : null;
  if (payer === null) {
    unknownWithoutPayer += 1;
    continue;
  }
  const day = String(row.ts ?? "").slice(0, 10);
  const seen = nonOwn.get(payer) ?? new Set();
  if (day !== "") seen.add(day);
  nonOwn.set(payer, seen);
}

const nonOwnCallers = nonOwn.size;
const repeatCallers = [...nonOwn.values()].filter((seenDays) => seenDays.size >= 2).length;
const gapToZero = nonOwnCallers === 0 ? 1 : 0;

line([
  `caller-provenance (last ${days}d)`,
  `non-own callers=${nonOwnCallers} (unknown provenance — not proven external)`,
  `repeat callers among them=${repeatCallers}`,
  `gap to zero=${gapToZero}`,
  `own events=${ownEvents}`,
  `unknown events=${unknownEvents}`,
  `pre-instrumentation events=${preInstrumentationEvents} (unknown-provenance: written before the column, never asked)`,
  `unknown without a payer identity=${unknownWithoutPayer}`,
  `go-live=${process.env.CALLER_PROVENANCE_GO_LIVE_AT ?? "unset — set it to the UTC time migration 20261125120000 was applied"}`,
]);
