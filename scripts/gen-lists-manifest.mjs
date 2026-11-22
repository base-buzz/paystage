#!/usr/bin/env node
/**
 * Generate the deny-list manifest the public /lists page renders.
 *
 * The page must never describe a list differently from what the code actually ships — a page claiming OFAC coverage that
 * the evaluator does not check is worse than no page at all, because it is the claim someone will rely on. So every number
 * and date here is *read from the source files*, and `--check` fails CI when the page has drifted from them.
 *
 *   node scripts/gen-lists-manifest.mjs          # write
 *   node scripts/gen-lists-manifest.mjs --check  # exit 1 when out of date
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/console/src/lib/lists.generated.ts");

const sanctioned = readFileSync(join(ROOT, "packages/preflight/src/sanctioned-addresses.ts"), "utf8");
const drainers = readFileSync(join(ROOT, "packages/preflight/src/known-drainers.ts"), "utf8");

const ofacCount = (sanctioned.match(/^\s{2}"0x[0-9a-f]{40}",$/gm) ?? []).length;
const ofacFetched = /fetched_at:\s*([0-9T:.-]+Z)/.exec(sanctioned)?.[1] ?? null;
const ofacSource = /Source:\s*(.+)/.exec(sanctioned)?.[1]?.trim() ?? null;
const ofacUrl = /(https:\/\/sanctionslistservice[^\s]+)/.exec(sanctioned)?.[1] ?? null;
const ofacSourceSha256 = /source_sha256:\s*([0-9a-f]{64})/.exec(sanctioned)?.[1] ?? null;

/**
 * The last *change*, from the ops change detector's snapshot (`apps/console/src/lib/list-freshness.json`).
 *
 * The page used to know only when the copy was retrieved, which cannot distinguish "nobody refreshed it" from "the
 * publisher has not changed it". The snapshot is written by `bin/list-change-detect.mjs` in the ops tree and copied
 * here on a detected change; when it is absent the page says "not recorded" rather than guessing a date.
 */
let listFreshness = null;
try {
  listFreshness = JSON.parse(readFileSync(join(ROOT, "apps/console/src/lib/list-freshness.json"), "utf8"));
} catch {
  listFreshness = null;
}
const ofacFreshness = listFreshness?.lists?.["ofac-sdn"] ?? null;
const changedSinceCopy =
  ofacFreshness?.sha256 && ofacSourceSha256 ? ofacFreshness.sha256 !== ofacSourceSha256 : null;

/**
 * Circle's on-chain `Blacklisted(address)` signal, from the ops collector's state file copied here
 * (`apps/console/src/lib/circle-blacklist.json`).
 *
 * Unlike OFAC, this is not a feed with a Last-Modified header: the event's date is the block's timestamp, so the page
 * can state a real first-event date. But it is also not a full history on a free RPC — the collector records which block
 * its coverage starts at and why, and the page must repeat that limit rather than let the count read as chain-wide.
 */
let circleSnapshot = null;
try {
  circleSnapshot = JSON.parse(readFileSync(join(ROOT, "apps/console/src/lib/circle-blacklist.json"), "utf8"));
} catch {
  circleSnapshot = null;
}
const circleCounts = circleSnapshot?.counts ?? null;

/** `SOURCES` is a literal array of {name, url, retrieved} — parse it rather than duplicating the list by hand. */
const sourceBlocks = [...drainers.matchAll(/\{\s*name:\s*"([^"]+)",\s*\n\s*url:\s*"([^"]+)",\s*\n\s*retrieved:\s*"([^"]+)",/g)].map(
  ([, name, url, retrieved]) => ({ name, url, retrieved }),
);

const drainerCount = (drainers.match(/^\s{2}"0x[0-9a-f]{40}",$/gm) ?? []).length;
const nonReceivable = [...drainers.matchAll(/^\s{2}"(0x[0-9a-f]{40})",\s*$/gm)].map(([, a]) => a).slice(-2);

/**
 * The positive list, from the same registry the evaluator uses.
 *
 * A deny list alone tells a reader what we block; it does not say what we would vouch for. These are the hosts whose 402 challenge
 * we have actually probed, with the payee they published on the day we looked — which is what makes rule 7c possible and what a
 * reader can hold us to.
 */
const services = JSON.parse(readFileSync(join(ROOT, "registry/services.json"), "utf8"));
const verifiedPayees = services
  .filter((s) => s.url && s.payTo)
  .map((s) => {
    let host = null;
    try {
      host = new URL(s.url).host;
    } catch {
      host = null;
    }
    return { host, service: s.name, payee: s.payTo.toLowerCase(), verified_at: s.verified_at ?? null };
  })
  .filter((e) => e.host)
  .sort((a, b) => String(a.host).localeCompare(String(b.host)));

const manifest = {
  verifiedPayees,
  generatedAt: new Date().toISOString().slice(0, 10),
  ofac: {
    name: "OFAC SDN — Digital Currency Address, ETH",
    publisher: "US Department of the Treasury, Office of Foreign Assets Control",
    source: ofacUrl,
    retrieved: ofacFetched,
    lastChangeAt: ofacFreshness?.lastChangeAt ?? null,
    lastChangeFields: ofacFreshness?.lastChangeFields ?? [],
    firstFetchedAt: ofacFreshness?.firstFetchedAt ?? null,
    detectorFetchedAt: ofacFreshness?.fetchedAt ?? null,
    lastModified: ofacFreshness?.lastModified ?? null,
    changedSinceCopy,
    addresses: ofacCount,
    maxAgeDays: 45,
    refresh:
      "The hourly canary hashes SDN.XML's Last-Modified and body and refreshes this file when either moves; the 45-day check is a floor and reads the list's last change, not only its age.",
  },
  circleBlacklist: {
    name: "Circle USDC blacklist — on-chain Base events",
    publisher: "Circle Internet Financial",
    source: circleSnapshot ? `https://basescan.org/address/${circleSnapshot.contract}` : null,
    chainId: circleSnapshot?.chainId ?? null,
    contract: circleSnapshot?.contract ?? null,
    topic: circleSnapshot?.topic ?? null,
    topicSignature: circleSnapshot?.topicSignature ?? null,
    events: circleCounts?.entries ?? null,
    addresses: circleCounts?.addresses ?? null,
    firstEventAt: circleCounts?.firstEventAt ?? null,
    firstEventBlock: circleCounts?.firstEventBlock ?? null,
    lastEventAt: circleCounts?.lastEventAt ?? null,
    lastEventBlock: circleCounts?.lastEventBlock ?? null,
    fromBlock: circleSnapshot?.fromBlock ?? null,
    toBlock: circleSnapshot?.toBlock ?? null,
    completeSinceDeployment: circleSnapshot?.coverage?.completeSinceDeployment ?? null,
    coverageNote: circleSnapshot?.coverage?.note ?? null,
    collectedAt: circleSnapshot?.generatedAt ?? null,
    enforced: false,
    refresh:
      "Re-run `node bin/circle-blacklist.mjs`; the collector appends new events and never drops an old one. No scheduled run is wired yet.",
  },
  drainers: {
    name: "Known drainers (curated)",
    addresses: drainerCount,
    sources: sourceBlocks,
  },
  nonReceivable: {
    name: "Non-receivable sinks",
    addresses: nonReceivable.length,
  },
};

const body = `/**
 * Generated by scripts/gen-lists-manifest.mjs — do not edit.
 *
 * Every figure here is read from the shipped source files, so the public page cannot claim a coverage the evaluator does
 * not have. Regenerate with \`node scripts/gen-lists-manifest.mjs\`.
 */
export const LISTS = ${JSON.stringify(manifest, null, 2)} as const;
`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== body) {
    console.error("lists-manifest: apps/console/src/lib/lists.generated.ts is out of date — run node scripts/gen-lists-manifest.mjs");
    process.exit(1);
  }
  console.log("lists-manifest: current");
  process.exit(0);
}

writeFileSync(OUT, body);
console.log(`lists-manifest: wrote ${OUT} — OFAC ${ofacCount}, drainers ${drainerCount}, sinks ${nonReceivable.length}, sources ${sourceBlocks.length}`);
