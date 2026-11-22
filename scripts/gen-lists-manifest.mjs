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
 *
 * The *enforced* set is read from the generated corpus the evaluator imports
 * (`packages/preflight/src/circle-blacklist-addresses.ts`), not from this snapshot: the page's count must be the set the
 * code actually checks, or it would describe a list the product does not ship. The snapshot supplies provenance and the
 * event dates; the corpus supplies membership (#369).
 */
let circleSnapshot = null;
try {
  circleSnapshot = JSON.parse(readFileSync(join(ROOT, "apps/console/src/lib/circle-blacklist.json"), "utf8"));
} catch {
  circleSnapshot = null;
}
const circleCounts = circleSnapshot?.counts ?? null;
const circleCorpus = readFileSync(join(ROOT, "packages/preflight/src/circle-blacklist-addresses.ts"), "utf8");
/**
 * The corpus is generated as `{ address, state, since, blockNumber }` rows (#370), not a bare address list. Parse the
 * rows so the count enforced and the state the page explains come from one artifact; a `state: "unblacklisted"` row is
 * carried, but never counted as enforced.
 */
const circleStates = [...circleCorpus.matchAll(
  /\{ address: "(0x[0-9a-f]{40})", state: "(blacklisted|unblacklisted)", since: (null|"[^"]*"), blockNumber: (\d+) \}/g,
)].map(([, address, state, since, blockNumber]) => ({
  address: address.toLowerCase(),
  state,
  since: since === "null" ? null : since.slice(1, -1),
  blockNumber: Number(blockNumber),
}));
const circleAddresses = circleStates.filter((entry) => entry.state === "blacklisted").map((entry) => entry.address);
const circleUnblacklisted = circleStates.filter((entry) => entry.state === "unblacklisted");
const circleCorpusMeta = {
  collectedAt: /collected_at:\s*(\S+)/.exec(circleCorpus)?.[1] ?? null,
  coveredFromBlock: Number(/covered_from_block:\s*(\d+)/.exec(circleCorpus)?.[1] ?? NaN),
  coveredToBlock: Number(/covered_to_block:\s*(\d+)/.exec(circleCorpus)?.[1] ?? NaN),
  firstEventAt: /first_event_at:\s*(\S+)/.exec(circleCorpus)?.[1] ?? null,
  lastEventAt: /last_event_at:\s*(\S+)/.exec(circleCorpus)?.[1] ?? null,
  lastUnblacklistAt: /last_unblacklist_at:\s*(\S+)/.exec(circleCorpus)?.[1] ?? null,
  removed: Number(/removed:\s*(\d+)/.exec(circleCorpus)?.[1] ?? NaN),
};
if (circleAddresses.length === 0) {
  console.error("lists-manifest: the Circle corpus has no addresses — refusing to publish a count of zero");
  process.exit(1);
}
// The corpus is what the evaluator enforces; the snapshot is what the page dates. They are written together by the
// collector, so a mismatch means a half-refreshed tree, and the page must not paper over it.
const snapshotStates = circleSnapshot?.states ?? [];
const snapshotEnforcedUnique = new Set(
  snapshotStates.filter((entry) => entry?.state === "blacklisted").map((entry) => String(entry.address).toLowerCase()),
);
const snapshotUnblacklisted = snapshotStates.filter((entry) => entry?.state === "unblacklisted").length;
if (circleSnapshot && (snapshotEnforcedUnique.size !== circleAddresses.length || snapshotUnblacklisted !== circleUnblacklisted.length)) {
  console.error(
    `lists-manifest: Circle corpus has ${circleAddresses.length} enforced / ${circleUnblacklisted.length} unblacklisted addresses but the page snapshot has ${snapshotEnforcedUnique.size} / ${snapshotUnblacklisted} — re-run node /work/ops/bin/circle-blacklist.mjs --export-only`,
  );
  process.exit(1);
}


/** `SOURCES` is a literal array of {name, url, retrieved} — parse it rather than duplicating the list by hand. */
const sourceBlocks = [...drainers.matchAll(/\{\s*name:\s*"([^"]+)",\s*\n\s*url:\s*"([^"]+)",\s*\n\s*retrieved:\s*"([^"]+)",/g)].map(
  ([, name, url, retrieved]) => ({ name, url, retrieved }),
);

/**
 * Per-entry citations are the authority (#362 A3).
 *
 * Previously the attribution lived only in comments above each address, and the list-level page could not be checked
 * one entry at a time. `DRAINER_ENTRIES` carries `{ address, source, readDate, note }` for every address; the page
 * renders one row per entry, and `check-drainer-citations.mjs` fails a missing, non-https or stale citation.
 */
const entriesStart = drainers.indexOf("export const DRAINER_ENTRIES");
const entriesEnd = entriesStart >= 0 ? drainers.indexOf("\n]);", entriesStart) : -1;
const entriesBlock = entriesStart >= 0 && entriesEnd > entriesStart ? drainers.slice(entriesStart, entriesEnd) : "";
const citationEntries = [...entriesBlock.matchAll(/\{\s*([\s\S]*?)\n\s*\},?/g)].map(([, body]) => {
  const address = /address:\s*"([^"]+)"/.exec(body)?.[1] ?? null;
  return {
    address: address ? address.toLowerCase() : null,
    source: /source:\s*"([^"]*)"/.exec(body)?.[1] ?? null,
    readDate: /readDate:\s*"([^"]*)"/.exec(body)?.[1] ?? null,
    note: /note:\s*"([^"]*)"/.exec(body)?.[1] ?? null,
  };
}).filter((entry) => entry.address);
if (citationEntries.length === 0) {
  console.error("lists-manifest: no DRAINER_ENTRIES parsed — refusing to publish a list without per-entry citations");
  process.exit(1);
}

const nonReceivableStart = drainers.indexOf("export const NON_RECEIVABLE");
const nonReceivableEnd = nonReceivableStart >= 0 ? drainers.indexOf("\n]);", nonReceivableStart) : -1;
const nonReceivableBlock = nonReceivableStart >= 0 && nonReceivableEnd > nonReceivableStart
  ? drainers.slice(nonReceivableStart, nonReceivableEnd)
  : "";
const nonReceivable = [...nonReceivableBlock.matchAll(/"(0x[0-9a-f]{40})"/g)].map(([, a]) => a);

/** The address sets, for the coverage dedupe. Read from the same files the evaluator ships, never retyped. */
const ofacAddresses = [...sanctioned.matchAll(/"(0x[0-9a-f]{40})"/g)].map(([, address]) => address.toLowerCase());
const drainerAddresses = citationEntries.map((entry) => entry.address);
const drainerCount = drainerAddresses.length;
const sinkAddresses = nonReceivable.map((address) => address.toLowerCase());

/** One label per publisher host, so the stacked source bar keeps its meaning with per-entry URLs. */
const SOURCE_HOST_LABELS = new Map([
  ["raw.githubusercontent.com", "MyEtherWallet ethereum-lists darklist"],
  ["www.0xcert.com", "0xCERT advisories and IOC feed"],
  ["www.cryptotimes.io", "CryptoTimes / Matcha Meta advisory"],
  ["chainabuse.com", "Chainabuse reports"],
]);
function publisherFor(source) {
  if (!source || source === "unattributed") return "unattributed";
  try {
    return SOURCE_HOST_LABELS.get(new URL(source).host) ?? new URL(source).host;
  } catch {
    return "unattributed";
  }
}
const drainerSourceCounts = [];
for (const entry of citationEntries) {
  const name = publisherFor(entry.source);
  const row = drainerSourceCounts.find((source) => source.name === name);
  if (row) row.count += 1;
  else drainerSourceCounts.push({ name, url: null, retrieved: null, count: 1 });
}
drainerSourceCounts.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
const drainerContributingSources = drainerSourceCounts.filter((source) => source.count > 0);

/** The newest supply-catalogue reading, copied into the repo by `scripts/gen-catalogue-snapshot.mjs`. */
let catalogue = null;
try {
  catalogue = JSON.parse(readFileSync(join(ROOT, "apps/console/src/lib/catalogue.json"), "utf8"));
} catch {
  catalogue = null;
}
const cataloguePayees =
  catalogue && Number.isInteger(Number(catalogue.payees)) && Number(catalogue.payees) > 0 ? Number(catalogue.payees) : null;

/** Lowercased union, preserving the first list that contributed an address. */
function unionOf(lists) {
  const seen = new Map();
  for (const [id, addresses] of lists) {
    for (const address of addresses) if (!seen.has(address)) seen.set(address, id);
  }
  return seen;
}

const enforcedAddresses = unionOf([
  ["ofac", ofacAddresses],
  ["drainers", drainerAddresses],
  ["nonReceivable", sinkAddresses],
  ["circleBlacklist", circleAddresses],
]);
// Every list on this page is now enforced by the evaluator (#369 moved Circle from collected to enforced), so the
// collected union and the enforced union are the same set. They stay separate names because a future collected-only
// list must show up as a gap rather than silently joining the coverage numerator.
const allAddresses = enforcedAddresses;
const listShapes = [
  { id: "ofac", label: "OFAC SDN", addresses: ofacAddresses },
  { id: "drainers", label: "Known drainers", addresses: drainerAddresses },
  { id: "nonReceivable", label: "Non-receivable sinks", addresses: sinkAddresses },
  { id: "circleBlacklist", label: "Circle blacklist", addresses: circleAddresses },
];
const coveragePerList = [];
const coverageSeen = new Map();
const rawCoverageTotal = listShapes.reduce((sum, list) => sum + new Set(list.addresses).size, 0);
for (const list of listShapes) {
  const unique = new Set(list.addresses);
  const overlaps = new Set();
  let contribution = 0;
  for (const address of unique) {
    const owner = coverageSeen.get(address);
    if (owner) overlaps.add(owner);
    else {
      coverageSeen.set(address, list.id);
      contribution += 1;
    }
  }
  coveragePerList.push({
    id: list.id,
    label: list.label,
    count: unique.size,
    uniqueContribution: contribution,
    overlapsWith: [...overlaps],
  });
}
const coverageNumerator = allAddresses.size;
const coveragePercent = cataloguePayees === null ? null : (coverageNumerator / cataloguePayees) * 100;

const ofacLastModifiedIso = ofacFreshness?.lastModified ? new Date(ofacFreshness.lastModified).toISOString() : null;
const ofacFreshnessAt = ofacFreshness?.lastChangeAt ?? ofacLastModifiedIso ?? ofacFreshness?.firstFetchedAt ?? null;
const ofacFreshnessBasis = ofacFreshness?.lastChangeAt
  ? "last-change"
  : ofacLastModifiedIso
    ? "last-modified"
    : ofacFreshness?.firstFetchedAt
      ? "first-fetch"
      : "none";
const drainerReviewedAt =
  citationEntries
    .map((entry) => entry.readDate)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

/** The refresh strip's facts. `failed` is only claimed when a state file records it; otherwise the result is unknown. */
const ofacRefreshFailed = Boolean(listFreshness?.error);
const ofacRefreshResult = ofacRefreshFailed
  ? String(listFreshness.error)
  : changedSinceCopy === true
    ? "upstream changed since this copy — the next release carries it"
    : ofacFreshness
      ? "unchanged — no body or Last-Modified move since the previous check"
      : "no detector record in this build";

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
  /**
   * The denominator and the deduplicated numerator, generated so the page cannot print a precise count without
   * stating the population it is precise against.
   */
  coverage: {
    numerator: coverageNumerator,
    rawTotal: rawCoverageTotal,
    duplicatesRemoved: rawCoverageTotal - coverageNumerator,
    dedupedAcrossLists: true,
    perList: coveragePerList,
    denominator: cataloguePayees,
    denominatorKind: "distinct payees in the supply catalogue",
    ratio: cataloguePayees === null ? null : coverageNumerator / cataloguePayees,
    percent: coveragePercent,
    enforcedNumerator: enforcedAddresses.size,
    collectedOnly: coverageNumerator - enforcedAddresses.size,
    catalogueSnapshot: catalogue?.snapshot ?? null,
    catalogueMeasuredAt: catalogue?.measuredAt ?? null,
    catalogueSource: catalogue?.source ?? null,
    catalogueRows: catalogue?.rows ?? null,
    catalogueTotalAdvertised: catalogue?.totalAdvertised ?? null,
  },
  ofac: {
    name: "OFAC SDN — Digital Currency Address, ETH",
    monogram: "OF",
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
    freshness: {
      upstreamChangedAt: ofacFreshnessAt,
      basis: ofacFreshnessBasis,
      reviewedAt: null,
      hasUpstreamFeed: true,
    },
    sources: [{ name: "US Treasury OFAC", url: ofacUrl, count: ofacCount }],
    growth: { retrievals: ofacFetched ? [{ at: ofacFetched, count: ofacCount }] : [] },
    refreshInfo: {
      command: "node /work/ops/bin/ofac-sync.mjs",
      where: "hourly canary — bin/canary-digest.sh",
      lastRunAt: ofacFreshness?.fetchedAt ?? null,
      status: ofacRefreshFailed ? "failed" : ofacFreshness ? "ok" : "unknown",
      lastResult: ofacRefreshResult,
    },
    refresh:
      "The hourly canary hashes SDN.XML's Last-Modified and body and refreshes this file when either moves; the 45-day check is a floor and reads the list's last change, not only its age.",
  },
  circleBlacklist: {
    name: "Circle USDC blacklist — on-chain Base events",
    monogram: "CB",
    publisher: "Circle Internet Financial",
    sourceId: "circle-blacklist",
    chainName: "Base",
    source: circleSnapshot ? `https://basescan.org/address/${circleSnapshot.contract}` : null,
    chainId: circleSnapshot?.chainId ?? null,
    contract: circleSnapshot?.contract ?? null,
    topic: circleSnapshot?.topics?.blacklisted ?? circleSnapshot?.topic ?? null,
    topicSignature: circleSnapshot?.topicSignatures?.blacklisted ?? circleSnapshot?.topicSignature ?? null,
    unblacklistedTopic: circleSnapshot?.topics?.unblacklisted ?? null,
    unblacklistedTopicSignature: circleSnapshot?.topicSignatures?.unblacklisted ?? null,
    events: circleCounts?.entries ?? null,
    blacklistEvents: circleCounts?.blacklistEvents ?? null,
    unblacklistEvents: circleCounts?.unblacklistEvents ?? null,
    addresses: circleAddresses.length,
    unblacklisted: circleUnblacklisted.length,
    /** Every address with a state row, for the page's per-address table. `since` is the last event's block timestamp. */
    states: circleStates.map((entry) => ({ address: entry.address, state: entry.state, since: entry.since, blockNumber: entry.blockNumber })),
    firstEventAt: circleCounts?.firstEventAt ?? circleCorpusMeta.firstEventAt,
    firstEventBlock: circleCounts?.firstEventBlock ?? null,
    lastEventAt: circleCounts?.lastEventAt ?? circleCorpusMeta.lastEventAt,
    lastEventBlock: circleCounts?.lastEventBlock ?? null,
    lastUnblacklistAt: circleCounts?.lastUnblacklistAt ?? circleCorpusMeta.lastUnblacklistAt,
    fromBlock: circleSnapshot?.fromBlock ?? (Number.isSafeInteger(circleCorpusMeta.coveredFromBlock) ? circleCorpusMeta.coveredFromBlock : null),
    toBlock: circleSnapshot?.toBlock ?? (Number.isSafeInteger(circleCorpusMeta.coveredToBlock) ? circleCorpusMeta.coveredToBlock : null),
    completeSinceDeployment: circleSnapshot?.coverage?.completeSinceDeployment ?? null,
    coverageNote: circleSnapshot?.coverage?.note ?? null,
    collectedAt: circleCorpusMeta.collectedAt ?? circleSnapshot?.generatedAt ?? null,
    enforced: true,
    enforcedBy: "preflight accept.payee_blacklisted_onchain",
    enforcedReason:
      "Circle blacklisted this address on Base (eip155:8453 USDC Blacklisted event) — a contract-level freeze by the issuer, not an OFAC listing",
    /**
     * #370: both `Blacklisted` and `UnBlacklisted` are read, and the latest event per address decides the state. The
     * page can therefore state that an unfreeze is reflected, not just that a freeze was once seen.
     */
    delistingTracked: true,
    freshness: {
      upstreamChangedAt: circleCorpusMeta.collectedAt ?? circleSnapshot?.generatedAt ?? null,
      basis: "collection",
      reviewedAt: null,
      hasUpstreamFeed: true,
    },
    sources: [
      {
        name: "Circle USDC Blacklisted(address) and UnBlacklisted(address) events on Base",
        url: circleSnapshot ? `https://basescan.org/address/${circleSnapshot.contract}` : null,
        count: circleAddresses.length,
      },
    ],
    growth: {
      retrievals: (circleCorpusMeta.collectedAt ?? circleSnapshot?.generatedAt)
        ? [{ at: circleCorpusMeta.collectedAt ?? circleSnapshot.generatedAt, count: circleAddresses.length }]
        : [],
    },
    refreshInfo: {
      command: "node /work/ops/bin/circle-blacklist.mjs",
      where: "hourly canary — bin/canary-digest.sh (same run as OFAC)",
      lastRunAt: circleCorpusMeta.collectedAt ?? circleSnapshot?.generatedAt ?? null,
      status: circleSnapshot ? "ok" : "unknown",
      lastResult: circleSnapshot
        ? `enforced ${circleAddresses.length} distinct addresses across blocks ${circleSnapshot.fromBlock}–${circleSnapshot.toBlock}`
        : "no collection recorded in this build",
    },
    refresh:
      "The hourly canary runs the collector beside OFAC: it appends new `Blacklisted` and `UnBlacklisted` events, exports the evaluator corpus and this page snapshot, then regenerates the manifest. If the RPC scan fails it runs `--export-only`, so the last good list stays enforced rather than going stale. The latest event per address decides the state, so a Circle unfreeze lifts the refusal instead of leaving it in place forever.",
  },
  drainers: {
    name: "Known drainers (curated)",
    monogram: "DR",
    addresses: drainerCount,
    sources: sourceBlocks,
    sourceCounts: drainerContributingSources,
    contributingSources: drainerContributingSources.length,
    /** One `{ address, source, readDate, note }` row per entry, so the page can cite the address it blocks. */
    entries: citationEntries,
    attributed: citationEntries.filter((entry) => entry.source && entry.source !== "unattributed").length,
    unattributed: citationEntries.filter((entry) => !entry.source || entry.source === "unattributed").length,
    citationMaxAgeDays: 180,
    freshness: {
      upstreamChangedAt: null,
      basis: "review",
      reviewedAt: drainerReviewedAt,
      hasUpstreamFeed: false,
    },
    growth: {
      retrievals: drainerReviewedAt ? [{ at: drainerReviewedAt, count: drainerCount }] : [],
    },
    refreshInfo: {
      command: "curated in packages/preflight/src/known-drainers.ts",
      where: "repository — no scheduled fetch",
      lastRunAt: drainerReviewedAt,
      status: "unknown",
      lastResult: "the list is edited with cited sources, not fetched from a feed",
    },
  },
  nonReceivable: {
    name: "Non-receivable sinks",
    monogram: "NR",
    addresses: nonReceivable.length,
    sources: [{ name: "Protocol sinks (burn and zero address)", url: null, count: nonReceivable.length }],
    freshness: {
      upstreamChangedAt: null,
      basis: "none",
      reviewedAt: null,
      hasUpstreamFeed: false,
    },
    growth: { retrievals: [] },
    refreshInfo: {
      command: "curated in packages/preflight/src/known-drainers.ts",
      where: "repository — no scheduled fetch",
      lastRunAt: null,
      status: "unknown",
      lastResult: "the sinks are a fixed protocol constant, not fetched from a feed",
    },
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
console.log(
  `lists-manifest: wrote ${OUT} — OFAC ${ofacCount}, drainers ${drainerCount}, sinks ${nonReceivable.length}, sources ${sourceBlocks.length}, coverage ${coverageNumerator}/${cataloguePayees ?? "no denominator"}`,
);
