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
const circleAddresses = [...circleCorpus.matchAll(/^\s{2}"(0x[0-9a-f]{40})",$/gm)].map(([, address]) => address.toLowerCase());
const circleCorpusMeta = {
  collectedAt: /collected_at:\s*(\S+)/.exec(circleCorpus)?.[1] ?? null,
  coveredFromBlock: Number(/covered_from_block:\s*(\d+)/.exec(circleCorpus)?.[1] ?? NaN),
  coveredToBlock: Number(/covered_to_block:\s*(\d+)/.exec(circleCorpus)?.[1] ?? NaN),
  firstEventAt: /first_event_at:\s*(\S+)/.exec(circleCorpus)?.[1] ?? null,
  removed: Number(/removed:\s*(\d+)/.exec(circleCorpus)?.[1] ?? NaN),
};
if (circleAddresses.length === 0) {
  console.error("lists-manifest: the Circle corpus has no addresses — refusing to publish a count of zero");
  process.exit(1);
}
// The corpus is what the evaluator enforces; the snapshot is what the page dates. They are written together by the
// collector, so a mismatch means a half-refreshed tree, and the page must not paper over it.
const snapshotEnforced = (circleSnapshot?.entries ?? [])
  .filter((entry) => entry?.removed !== true)
  .map((entry) => String(entry.address).toLowerCase());
const snapshotEnforcedUnique = new Set(snapshotEnforced);
if (circleSnapshot && snapshotEnforcedUnique.size !== circleAddresses.length) {
  console.error(
    `lists-manifest: Circle corpus has ${circleAddresses.length} enforced addresses but the page snapshot has ${snapshotEnforcedUnique.size} — re-run node /work/ops/bin/circle-blacklist.mjs --export-only`,
  );
  process.exit(1);
}


/** `SOURCES` is a literal array of {name, url, retrieved} — parse it rather than duplicating the list by hand. */
const sourceBlocks = [...drainers.matchAll(/\{\s*name:\s*"([^"]+)",\s*\n\s*url:\s*"([^"]+)",\s*\n\s*retrieved:\s*"([^"]+)",/g)].map(
  ([, name, url, retrieved]) => ({ name, url, retrieved }),
);

const nonReceivable = [...drainers.matchAll(/^\s{2}"(0x[0-9a-f]{40})",\s*$/gm)].map(([, a]) => a).slice(-2);

/** The address sets, for the coverage dedupe. Read from the same files the evaluator ships, never retyped. */
const ofacAddresses = [...sanctioned.matchAll(/"(0x[0-9a-f]{40})"/g)].map(([, address]) => address.toLowerCase());
const drainerBlock = drainers.slice(drainers.indexOf("export const KNOWN_DRAINERS"), drainers.indexOf("export const NON_RECEIVABLE"));
const drainerAddresses = [...drainerBlock.matchAll(/"(0x[0-9a-f]{40})"/g)].map(([, address]) => address.toLowerCase());
// Count the parsed set, not the prettiest line shape: three entries carry an inline `// share` comment and the old
// line-based regex silently read the list as 23 rather than 24.
const drainerCount = drainerAddresses.length;
const sinkAddresses = nonReceivable.map((address) => address.toLowerCase());

/**
 * Per-source counts for the drainer list.
 *
 * The file cites a source in the comment above each entry, and that citation is the only place the attribution exists —
 * there is no `source` field on an address. Parsing the nearest preceding citation is the honest derivation; an entry
 * with no recognisable citation is counted as unattributed rather than assigned to a publisher by guesswork.
 */
const sourceByUrl = new Map(sourceBlocks.map((source) => [source.url, source.name]));
const drainerSourceCounts = sourceBlocks.map((source) => ({ ...source, count: 0 }));
const drainerCountByName = new Map(drainerSourceCounts.map((source) => [source.name, source]));
let currentSource = "Unattributed (curated)";
for (const line of drainerBlock.split("\n")) {
  const text = line.trim();
  if (text.startsWith("//")) {
    const cited = /https?:\/\/\S+/.exec(text)?.[0]?.replace(/[.,;)]$/, "") ?? null;
    if (cited && sourceByUrl.has(cited)) currentSource = sourceByUrl.get(cited);
    else if (/MEW darklist/i.test(text)) currentSource = sourceBlocks[0]?.name ?? currentSource;
    continue;
  }
  if (/^"0x[0-9a-f]{40}",?(?:\s*\/\/.*)?$/.test(text)) {
    const row = drainerCountByName.get(currentSource);
    if (row) row.count += 1;
    else drainerSourceCounts.push({ name: currentSource, url: null, retrieved: null, count: 1 });
  }
}
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
  sourceBlocks
    .map((source) => source.retrieved)
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
    topic: circleSnapshot?.topic ?? null,
    topicSignature: circleSnapshot?.topicSignature ?? null,
    events: circleCounts?.entries ?? null,
    addresses: circleAddresses.length,
    firstEventAt: circleCounts?.firstEventAt ?? circleCorpusMeta.firstEventAt,
    firstEventBlock: circleCounts?.firstEventBlock ?? null,
    lastEventAt: circleCounts?.lastEventAt ?? null,
    lastEventBlock: circleCounts?.lastEventBlock ?? null,
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
     * The collector reads `Blacklisted` only. It has no `UnBlacklisted` feed, so an address Circle later unfroze would
     * still be refused by this build. The page states that limit rather than letting "enforced" read as a live balance.
     */
    delistingTracked: false,
    freshness: {
      upstreamChangedAt: circleCorpusMeta.collectedAt ?? circleSnapshot?.generatedAt ?? null,
      basis: "collection",
      reviewedAt: null,
      hasUpstreamFeed: true,
    },
    sources: [
      {
        name: "Circle USDC Blacklisted(address) events on Base",
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
      "The hourly canary runs the collector beside OFAC: it appends new `Blacklisted` events, exports the evaluator corpus and this page snapshot, then regenerates the manifest. If the RPC scan fails it runs `--export-only`, so the last good list stays enforced rather than going stale. It reads `Blacklisted` events only — there is no `UnBlacklisted` feed yet, so an address Circle later unfroze would still be refused.",
  },
  drainers: {
    name: "Known drainers (curated)",
    monogram: "DR",
    addresses: drainerCount,
    sources: sourceBlocks,
    sourceCounts: drainerContributingSources,
    contributingSources: drainerContributingSources.length,
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
