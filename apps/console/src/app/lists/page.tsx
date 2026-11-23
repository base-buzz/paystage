import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";
import { LISTS } from "@/lib/lists.generated";
import { CheckedSellersPanel } from "@/components/CheckedSellersPanel";
import {
  buildGrowth,
  freshnessView,
  growthLabel,
  refreshLine,
  sourceBar,
  sparklinePoints,
  type FreshnessInput,
  type RefreshInfo,
  type SourceCount,
} from "@/lib/list-coverage";

/**
 * /lists — the deny lists this product actually checks, with their provenance.
 *
 * Why this page exists: a payment tool that blocks addresses owes the person being blocked an answer to "on whose authority,
 * and how current is it". Without this page the answer is a stack trace. The rule for everything below is that a claim is
 * only printed if the shipped code makes it true — the counts and dates come from `scripts/gen-lists-manifest.mjs`, which
 * reads the source files, and `--check` fails CI when they drift.
 *
 * What this page deliberately does not do is imply compliance coverage. It is an exact-address check against public lists,
 * refreshed on a schedule, with the staleness window stated. It is not screening, not identity resolution, and not legal
 * advice, and the last section says so in those words.
 */
export const metadata: Metadata = {
  title: "Deny lists",
  description:
    "The sanctions and drainer lists PayStage checks before a payment is allowed, plus Circle's on-chain USDC blacklist events: sources, retrieval and last-change dates, counts, refresh cadence and the limits of exact-address matching. Also a dated, read-only probe of the top of Bazaar's x402 catalogue: which endpoints answer a correct 402 and at what price.",
};

const ageDays = (iso: string): number => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const changedLabel = (fields: readonly string[]): string =>
  fields.length === 2 ? "last-modified and body" : fields.join(" and ");

/** A readable link label for a per-entry citation; the URL itself is in the href and the generated manifest. */
const citationLabel = (source: string): string => {
  try {
    const host = new URL(source).host;
    const labels: Record<string, string> = {
      "raw.githubusercontent.com": "MEW ethereum-lists darklist",
      "www.0xcert.com": "0xCERT advisory",
      "www.cryptotimes.io": "CryptoTimes / Matcha Meta",
      "chainabuse.com": "Chainabuse report",
    };
    return labels[host] ?? host;
  } catch {
    return source;
  }
};

/** One card's generated inputs. Nothing below is typed into JSX. */
interface ListCard {
  id: string;
  monogram: string;
  name: string;
  addresses: number;
  freshness: FreshnessInput;
  sources: readonly SourceCount[];
  /** Retrieval dates already stored; one point renders as a count, not a line. */
  retrievals: readonly { at: string; count: number }[];
  refresh: RefreshInfo;
}

const basisLabel = (basis: FreshnessInput["basis"]): string =>
  ({
    "last-change": "last upstream change",
    "last-modified": "publisher Last-Modified",
    "first-fetch": "first watched fetch (no change observed)",
    "last-event": "last on-chain event",
    collection: "last collection",
    review: "curation review",
    none: "no date",
  })[basis] ?? "date basis not recorded";

function Freshness({ card, now }: { card: ListCard; now: number }) {
  const view = freshnessView(card.freshness, now);
  if (view.kind === "reviewed") {
    return (
      <span className="lp-list-chip lp-list-chip-review" title={view.label}>
        {view.label}
      </span>
    );
  }
  return (
    <span className={`lp-list-chip lp-list-chip-${view.tone}`} title={`${basisLabel(view.basis)}: ${view.at.slice(0, 10)}`}>
      {view.label}
      <span className="lp-list-chip-basis">{basisLabel(view.basis)}</span>
    </span>
  );
}

function SourceStack({ card }: { card: ListCard }) {
  const bar = sourceBar(card.sources);
  return (
    <div className="lp-list-source">
      <div
        className="lp-list-source-bar"
        role="img"
        aria-label={
          bar.singleSource
            ? `single source: ${bar.slices[0]?.name ?? "unnamed"}, ${bar.total} entries`
            : `${bar.contributing} sources, ${bar.total} entries`
        }
      >
        {bar.slices.map((slice, index) => (
          <span
            key={slice.name}
            className={`lp-list-source-slice lp-list-source-slice-${index % 6}`}
            style={{ width: `${slice.percent}%` }}
            title={`${slice.name}: ${slice.count} (${slice.percent.toFixed(1)}%)`}
          />
        ))}
      </div>
      <p className="lp-list-caption">
        {bar.singleSource
          ? `Single source — ${bar.slices[0]?.name ?? "unnamed publisher"}, ${bar.total} entries.`
          : `${bar.contributing} contributing sources across ${bar.total} entries.`}
      </p>
    </div>
  );
}

function Growth({ card }: { card: ListCard }) {
  const series = buildGrowth(card.retrievals);
  const points = sparklinePoints(series);
  return (
    <div className="lp-list-growth">
      <p className="lp-list-caption">{growthLabel(series, card.addresses)}</p>
      {series.drawLine ? (
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={growthLabel(series, card.addresses)}>
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="lp-list-growth-empty">one sample, not a trend</div>
      )}
    </div>
  );
}

export default function ListsPage() {
  const ofac = LISTS.ofac;
  // `lists.generated.ts` is emitted `as const`; today's snapshot has no recorded change, so `null` would otherwise be
  // narrowed to `never` and the "a change may arrive later" branch would not type-check.
  const ofacLastChangeAt = ofac.lastChangeAt as string | null;
  const ofacLastChangeFields = ofac.lastChangeFields as readonly string[];
  const ofacFirstFetchedAt = ofac.firstFetchedAt as string | null;
  const drainers = LISTS.drainers;
  // The generated manifest is `as const`, so today's fully-attributed list narrows `source` to a URL union and
  // the `unattributed` branch would not type-check. Keep the shape explicit: a future entry may have no source.
  const drainerEntries: readonly { address: string; source: string; readDate: string | null; note?: string }[] =
    drainers.entries;
  const sinks = LISTS.nonReceivable;
  const circle = LISTS.circleBlacklist;
  // `lists.generated.ts` is emitted `as const`; when the snapshot is absent these fields are `null` and would narrow
  // to `never`, so the optional branches below would not type-check.
  const circleFirstEventAt = circle.firstEventAt as string | null;
  const circleLastEventAt = circle.lastEventAt as string | null;
  const circleCollectedAt = circle.collectedAt as string | null;
  const circleCoverageNote = circle.coverageNote as string | null;
  const ofacAge = ageDays(ofac.retrieved);
  // An old retrieval is only stale if the upstream body moved. The detector proves "unchanged" with a body hash; when
  // that proof is absent (no snapshot), fall back to the age window rather than assuming the list is current.
  const ofacStale = ofacAge > ofac.maxAgeDays && ofac.changedSinceCopy !== false;

  /** The generated coverage figures. `as const` makes a null snapshot narrow to `never`, so keep the null branch typed. */
  const coverage = LISTS.coverage;
  const coverageDenominator = coverage.denominator as number | null;
  const coveragePercent = coverage.percent as number | null;
  const now = Date.now();

  const cards: ListCard[] = [
    {
      id: "ofac",
      monogram: ofac.monogram,
      name: ofac.name,
      addresses: ofac.addresses,
      freshness: ofac.freshness,
      sources: ofac.sources,
      retrievals: ofac.growth.retrievals,
      refresh: ofac.refreshInfo,
    },
    {
      id: "drainers",
      monogram: drainers.monogram,
      name: drainers.name,
      addresses: drainers.addresses,
      freshness: drainers.freshness,
      sources: drainers.sourceCounts,
      retrievals: drainers.growth.retrievals,
      refresh: drainers.refreshInfo,
    },
    {
      id: "circleBlacklist",
      monogram: circle.monogram,
      name: circle.name,
      addresses: circle.addresses as number,
      freshness: circle.freshness,
      sources: circle.sources,
      retrievals: circle.growth.retrievals,
      refresh: circle.refreshInfo,
    },
    {
      id: "nonReceivable",
      monogram: sinks.monogram,
      name: sinks.name,
      addresses: sinks.addresses,
      freshness: sinks.freshness,
      sources: sinks.sources,
      retrievals: sinks.growth.retrievals,
      refresh: sinks.refreshInfo,
    },
  ];

  return (
    <main className="lp-wrap lp-prose">
      <h1>Deny lists</h1>
      <p className="lp-lead">
        Every payment this product evaluates is checked against {coverage.enforcedNumerator} unique addresses across{" "}
        {coverage.perList.length} lists. Against the {coverageDenominator ?? "unavailable"} payees in the supply catalogue
        that is {coveragePercent === null ? "no computable coverage" : `${coveragePercent.toFixed(1)}%`}. Each list, who
        publishes it, when this copy was retrieved, when its upstream feed last changed, and what the check does and does
        not mean is below. The figures are generated from the code that runs, so they cannot drift from what is shipped.
      </p>
      <p>
        Circle&apos;s on-chain USDC <code>Blacklisted(address)</code> and <code>UnBlacklisted(address)</code> events on
        Base are enforced too: a payment on Base to an address whose <em>latest</em> event is a freeze is refused with
        the reason code <code>payee_blacklisted_onchain</code>, and an address Circle later unfroze is not refused on
        that basis. That list covers events from block {circle.fromBlock ?? "51,000,000"} onward only — events below that
        block are not covered by the free RPC, so a non-match is not proof the address was never blacklisted, nor that
        an unfreeze below that block does not exist.
      </p>

      <section className="lp-list-coverage" aria-labelledby="coverage-heading">
        <h2 id="coverage-heading">Coverage against the catalogue</h2>
        <div className="lp-list-coverage-head">
          <p className="lp-list-coverage-big">
            {coverage.numerator}
            <span className="lp-list-coverage-denominator"> / {coverageDenominator ?? "no denominator"} payees</span>
          </p>
          <p className="lp-list-coverage-percent">{coveragePercent === null ? "no denominator in this build" : `${coveragePercent.toFixed(1)}%`}</p>
        </div>
        <div
          className="lp-list-coverage-track"
          role="img"
          aria-label={
            coveragePercent === null
              ? `${coverage.numerator} unique addresses; no catalogue denominator`
              : `${coverage.numerator} of ${coverageDenominator} catalogue payees, ${coveragePercent.toFixed(1)} percent`
          }
        >
          <span
            className="lp-list-coverage-fill"
            style={{ width: `${Math.max(coveragePercent ?? 0, 0.4)}%` }}
          />
        </div>
        <p className="lp-list-caption">
          {coverage.numerator} unique addresses from {coverage.perList.length} lists after deduplicating across lists
          ({coverage.rawTotal} entries before dedupe; {coverage.duplicatesRemoved} duplicates removed). All{" "}
          {coverage.enforcedNumerator} are enforced by the preflight evaluator; Circle&apos;s {circle.addresses} on-chain
          entries were the last list to move from collected to enforced. The denominator is {coverage.denominatorKind}
          {coverage.catalogueSnapshot ? ` (${coverage.catalogueSnapshot}, measured ${String(coverage.catalogueMeasuredAt).slice(0, 10)})` : ""}.
        </p>
      </section>

      <section aria-labelledby="cards-heading">
        <h2 id="cards-heading">Each list, and how fresh it is</h2>
        <div className="lp-list-cards">
          {cards.map((card) => (
            <article className="lp-list-card" key={card.id}>
              <div className="lp-list-card-head">
                <span className="lp-list-monogram" aria-hidden="true">
                  {card.monogram}
                </span>
                <div>
                  <h3>{card.name}</h3>
                  <p className="lp-list-count">{card.addresses} entries</p>
                </div>
              </div>
              <Freshness card={card} now={now} />
              <SourceStack card={card} />
              <Growth card={card} />
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="refresh-heading">
        <h2 id="refresh-heading">How this refreshes</h2>
        <div className="lp-list-refresh">
          {cards.map((card) => (
            <div className="lp-list-refresh-row" id={`refresh-${card.id}`} key={card.id}>
              <p className="lp-list-refresh-name">{card.name}</p>
              <code>{card.refresh.command}</code>
              <p className="lp-list-refresh-where">{card.refresh.where}</p>
              <p className={card.refresh.status === "failed" ? "lp-list-refresh-result lp-list-refresh-failed" : "lp-list-refresh-result"}>
                {refreshLine(card.refresh)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>What is checked</h2>

        <h3>{ofac.name}</h3>
        <table>
          <tbody>
            <tr>
              <th>Publisher</th>
              <td>{ofac.publisher}</td>
            </tr>
            <tr>
              <th>Source</th>
              <td>
                <a href={ofac.source} rel="noreferrer noopener" target="_blank">
                  SDN.XML
                </a>{" "}
                — the &quot;Digital Currency Address - ETH&quot; entries
              </td>
            </tr>
            <tr>
              <th>Addresses in this build</th>
              <td>{ofac.addresses}</td>
            </tr>
            <tr>
              <th>Retrieved</th>
              <td>
                {ofac.retrieved.slice(0, 10)} ({ofacAge} day{ofacAge === 1 ? "" : "s"} old)
                {ofacStale ? (
                  <strong style={{ color: "var(--lp-red, #b91c1c)" }}>
                    {" "}
                    — older than the {ofac.maxAgeDays}-day window. Treat this build&apos;s sanctions coverage as stale.
                  </strong>
                ) : ofacAge > ofac.maxAgeDays ? (
                  <span>
                    {" "}
                    — older than the {ofac.maxAgeDays}-day window, but the upstream list has not changed since this copy,
                    so the data is current.
                  </span>
                ) : (
                  <span> — inside the {ofac.maxAgeDays}-day window</span>
                )}
              </td>
            </tr>
            <tr>
              <th>Last change</th>
              <td>
                {ofacLastChangeAt ? (
                  <>
                    {ofacLastChangeAt.slice(0, 10)}
                    {ofacLastChangeFields.length ? ` — ${changedLabel(ofacLastChangeFields)}` : ""}
                    {ofac.changedSinceCopy ? (
                      <strong style={{ color: "var(--lp-red, #b91c1c)" }}>
                        {" "}
                        — newer than this build&apos;s copy; the next release carries it.
                      </strong>
                    ) : null}
                  </>
                ) : ofacFirstFetchedAt ? (
                  <>No change observed since the change detector&apos;s first fetch on {ofacFirstFetchedAt.slice(0, 10)}.</>
                ) : (
                  <>Not recorded — the change detector has not run against this build.</>
                )}
              </td>
            </tr>
            <tr>
              <th>Refresh</th>
              <td>{ofac.refresh}</td>
            </tr>
            <tr>
              <th>Effect</th>
              <td>
                <strong>Hard deny.</strong> A payment to one of these addresses is refused with the reason{" "}
                <code>sanctioned address (OFAC SDN)</code>. It is not a review, and no policy setting overrides it.
              </td>
            </tr>
          </tbody>
        </table>

        <h3>{drainers.name}</h3>
        <p>
          {drainers.addresses} addresses compiled from {drainers.contributingSources} publisher groups, and every row
          below carries its own source and the date this repository read it. The citation is per address, not per list,
          so one entry can be checked without trusting the other {drainers.addresses - 1}.{" "}
          {drainers.unattributed > 0
            ? `${drainers.unattributed} of ${drainers.addresses} entries are explicitly marked unattributed because no public source naming the address could be found; none is given an invented citation.`
            : `All ${drainers.addresses} entries in this build carry a source.`}
        </p>
        <table>
          <thead>
            <tr>
              <th>Address</th>
              <th>Source</th>
              <th>Read</th>
              <th>What the source says</th>
            </tr>
          </thead>
          <tbody>
            {drainerEntries.map((entry) => (
              <tr key={entry.address}>
                <td>
                  <code>{entry.address}</code>
                </td>
                <td>
                  {entry.source === "unattributed" ? (
                    <span
                      className="lp-list-unattributed"
                      title="No public source naming this address was found; the entry is kept but not given a citation"
                    >
                      unattributed
                    </span>
                  ) : (
                    <a href={entry.source} rel="noreferrer noopener" target="_blank">
                      {citationLabel(entry.source)}
                    </a>
                  )}
                </td>
                <td>{entry.readDate ?? "—"}</td>
                <td>{entry.note ?? "no note recorded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>These are read dates, not an upstream last-change.</strong> Each entry was checked against its source
          on the date in the Read column; the list is curated, so it has no publisher feed to watch and no honest
          last-modified date to state. The citation check fails the build after {drainers.citationMaxAgeDays} days, which
          is a re-verification cadence for the URL, not a claim that an older incident is recent; 180 days rather than
          the comparison matrix&apos;s 90 because these are historical incidents, not live product claims.
        </p>
        <p>
          <strong>Effect:</strong> hard deny with the reason <code>known drainer</code>. Separate from the sanctions check
          because the fact is different — a sanctioned address may make paying <em>you</em> the problem, a drainer takes the
          funds — and the refusal names which one applied.
        </p>

        <h3>Verified sellers — the positive list</h3>
        <p>
          A deny list says what we block. This says what we have actually checked: {LISTS.verifiedPayees.length} hosts whose 402
          challenge we probed, with the payee each one published on the date we looked. When a challenge names one of these hosts and
          a different <code>payTo</code>, the evaluator returns <strong>review</strong> — the endpoint may be a clone, or the seller
          may have rotated its payee, and only a human can tell which.
        </p>
        <table>
          <thead>
            <tr>
              <th>Host</th>
              <th>Payee</th>
              <th>Verified</th>
            </tr>
          </thead>
          <tbody>
            {LISTS.verifiedPayees.map((v) => (
              <tr key={`${v.host}-${v.payee}`}>
                <td>{v.host}</td>
                <td>
                  <code>
                    {v.payee.slice(0, 8)}…{v.payee.slice(-4)}
                  </code>
                </td>
                <td>{v.verified_at ?? "undated"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>What it is not:</strong> a vouch for the seller&apos;s honesty, and not a complete list — a host we have never
          probed is simply absent, and absence means <em>unknown</em>, not <em>cleared</em>.
        </p>

        <h3>{sinks.name}</h3>
        <p>
          {sinks.addresses} addresses where funds cannot be recovered: the canonical burn address and the zero address. Same
          verdict, truthful reason — paying one destroys the money rather than losing it to a thief.
        </p>
      </section>

      <CheckedSellersPanel />

      <section>
        <h2>
          On-chain signal — enforced: {circle.addresses} addresses, coverage from block {circle.fromBlock ?? "51,000,000"}
        </h2>

        <h3>{circle.name}</h3>
        <p>
          OFAC and the drainer list are snapshots: they are as current as their last copy. This signal is different. When Circle
          freezes an address it calls <code>blacklist(address)</code> on the USDC contract, and the contract emits{" "}
          <code>Blacklisted(address)</code>. The event is public in the rail a payment would use, and its date is the block&apos;s
          timestamp — so unlike the curated lists it needs no publisher feed to carry a real change date.
        </p>
        <table>
          <tbody>
            <tr>
              <th>Publisher</th>
              <td>{circle.publisher}</td>
            </tr>
            <tr>
              <th>Contract</th>
              <td>
                {circle.source ? (
                  <a href={circle.source} rel="noreferrer noopener" target="_blank">
                    USDC on Base (chain {circle.chainId})
                  </a>
                ) : (
                  "USDC on Base"
                )}{" "}
                — <code>{circle.contract}</code>
              </td>
            </tr>
            <tr>
              <th>Events</th>
              <td>
                <code>{circle.topicSignature}</code> <code>{circle.topic}</code>
                <br />
                <code>{circle.unblacklistedTopicSignature}</code> <code>{circle.unblacklistedTopic}</code>
              </td>
            </tr>
            <tr>
              <th>Current state</th>
              <td>
                {circle.addresses ?? "not collected"} addresses currently blacklisted (refused on Base);{" "}
                {circle.unblacklisted ?? "not collected"} currently unblacklisted (a later Circle event lifted the
                freeze). {circle.states?.length ?? 0} distinct addresses in the tracked range.
              </td>
            </tr>
            <tr>
              <th>Events collected</th>
              <td>
                {circle.events ?? "not collected"} total — {circle.blacklistEvents ?? "?"} <code>Blacklisted</code>,{" "}
                {circle.unblacklistEvents ?? "?"} <code>UnBlacklisted</code>
              </td>
            </tr>
            <tr>
              <th>First event</th>
              <td>
                {circleFirstEventAt ? (
                  <>
                    {circleFirstEventAt.slice(0, 10)} — block {circle.firstEventBlock}, the block&apos;s timestamp, not the
                    date this copy was collected
                  </>
                ) : (
                  "none in the tracked range"
                )}
              </td>
            </tr>
            <tr>
              <th>Latest event</th>
              <td>
                {circleLastEventAt ? (
                  <>
                    {circleLastEventAt.slice(0, 10)} — block {circle.lastEventBlock}
                  </>
                ) : (
                  "none in the tracked range"
                )}
                {circle.lastUnblacklistAt ? (
                  <>
                    {" "}
                    · latest unfreeze {circle.lastUnblacklistAt.slice(0, 10)}
                  </>
                ) : (
                  " · no UnBlacklisted event in the tracked range"
                )}
              </td>
            </tr>
            <tr>
              <th>Coverage</th>
              <td>
                Blocks {circle.fromBlock ?? "?"}–{circle.toBlock ?? "?"}.{" "}
                {circle.completeSinceDeployment ? (
                  <>Covered from the USDC deployment block.</>
                ) : (
                  <>
                    <strong>Earlier history is not covered.</strong> {circleCoverageNote} This is a coverage boundary, not a
                    statement that the address count is the whole chain.
                  </>
                )}
              </td>
            </tr>
            <tr>
              <th>Collected</th>
              <td>{circleCollectedAt ? circleCollectedAt.slice(0, 10) : "not collected"}</td>
            </tr>
            <tr>
              <th>Refresh</th>
              <td>{circle.refresh}</td>
            </tr>
            <tr>
              <th>Enforced</th>
              <td>
                <strong>Yes, on Base, for the latest event.</strong> A payment whose network is Base (chain{" "}
                {circle.chainId}) to one of these {circle.addresses} currently blacklisted addresses is refused with the
                reason code <code>payee_blacklisted_onchain</code> and the text{" "}
                <em>Circle blacklisted this address on Base (eip155:8453 USDC Blacklisted event) — a contract-level
                freeze by the issuer, not an OFAC listing</em>. The refusal names Circle&apos;s on-chain action, not a
                sanctions claim. An address whose later event is <code>UnBlacklisted</code> is not refused on this
                basis, even though the freeze stays in the event history. Coverage starts at block{" "}
                {circle.fromBlock ?? "51,000,000"};{" "}
                <strong>events below block {circle.fromBlock ?? "51,000,000"} are not covered</strong>, so a non-match is
                not clearance.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>What it is not:</strong> it does not give OFAC a last-change date, and it is not a substitute for OFAC.
          A Circle freeze is one company&apos;s action on one chain; it does not carry the legal effect of a sanctions
          listing, and an address absent here is not cleared. Both Circle events are read, and the latest one decides
          the state: a later <code>UnBlacklisted</code> lifts this refusal while an OFAC listing still fails the
          sanctions check independently. The rule is only as complete as the events the contract emits — if Circle
          restores an address without emitting <code>UnBlacklisted</code>, this data cannot see it.
        </p>

        <details className="lp-prose">
          <summary>
            Every address in the tracked range ({circle.states?.length ?? 0}), current state and the date of its last
            event
          </summary>
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Current state</th>
                <th>Last event</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {(circle.states ?? []).map((entry) => (
                <tr key={entry.address}>
                  <td>
                    <code>{entry.address}</code>
                  </td>
                  <td>
                    {entry.state === "blacklisted" ? (
                      <strong>Blacklisted — refused on Base</strong>
                    ) : (
                      <>Unblacklisted — the freeze was lifted</>
                    )}
                  </td>
                  <td>{entry.since ? entry.since.slice(0, 10) : "date not recorded in this copy"}</td>
                  <td>{entry.blockNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section>
        <h2>Provenance and freshness</h2>
        <ul>
          <li>
            <strong>Generated, not typed.</strong> The addresses live in generated source files that a sync job rewrites from
            the publisher&apos;s own feed. Nobody hand-edits the list, and the counts above are read from those files at build
            time.
          </li>
          <li>
            <strong>Dated twice.</strong> Each list carries the date its copy was retrieved, and the sanctions list also
            carries the date its upstream file last changed. Those are different facts: the first says when we fetched, the
            second says when the publisher edited. The {ofac.maxAgeDays}-day window is a floor — a copy over that age is only
            marked stale when the upstream body has moved.
          </li>
          <li>
            <strong>Change-detected on an hourly run.</strong> The hourly canary hashes SDN.XML&apos;s{" "}
            <code>Last-Modified</code> and body, and refreshes the list when either moves. A newly added address is therefore
            noticed on the next hourly run rather than up to {ofac.maxAgeDays} days later. The dates above come from that
            detector&apos;s snapshot, not from a typed number.
          </li>
          <li>
            <strong>Reviewed into the repository.</strong> Source URL, retrieval date and the publisher&apos;s own naming are
            kept with the entries, so a disputed block can be traced to the advisory that caused it.
          </li>
          <li>
            <strong>Delisting works the same way.</strong> When a publisher removes an address, the next sync removes it here
            and the block stops — the lists are replaced wholesale, not appended to.
          </li>
          <li>
            <strong>One source is on-chain, and dated by the block.</strong> The Circle signal is read from USDC
            <code>Blacklisted</code> and <code>UnBlacklisted</code> events on Base, not downloaded from a feed. Each
            event&apos;s date is its block timestamp, and the collector appends events rather than replacing the file, so
            an earlier event cannot disappear because a later scan did not see it. The latest event per address decides
            the state, and the coverage start is recorded and printed above because free RPC access does not reach the
            deployment block.
          </li>
        </ul>
      </section>

      <section>
        <h2>Checks that need the network</h2>
        <p>
          Two checks run only on the <strong>hosted</strong> API, because they call third parties and the local evaluator must work
          offline. Both fail closed: an outage downgrades a verdict to <code>review</code>, never to <code>pay</code>.
        </p>
        <ul>
          <li>
            <strong>Address risk (GoPlus).</strong> A payee flagged for sanctions, laundering, phishing or theft turns{" "}
            <code>pay</code> into <code>do_not_pay</code>, naming the source. It disagrees with our own list in both directions, which
            is the argument for reading both.
          </li>
          <li>
            <strong>Seller age (RDAP and certificate transparency).</strong> A seller host whose domain or first certificate is under
            thirty days old turns <code>pay</code> into <code>review</code> — a host with no history has none to lose. RDAP refuses
            this server, so the certificate date is usually the signal that answers.
          </li>
        </ul>
        <p>
          The observation is returned with the verdict (<code>seller_reputation</code>) whether or not it changes the answer, because a
          check that only speaks when it fires cannot be told apart from one that never ran.
        </p>
      </section>

      <section>
        <h2>What this does not do</h2>
        <p>
          Being specific about the limits is the point of the page. A tool that blocks addresses is trusted on the accuracy of
          its lists, and overstating that accuracy is how the trust gets lost.
        </p>
        <ul>
          <li>
            <strong>Exact address match only.</strong> A payment is compared to a list entry after lowercasing. No fuzzy
            matching, no clustering, no look-alike detection — an address one character away is a different address, because
            it is one.
          </li>
          <li>
            <strong>No hops, no exposure analysis.</strong> We do not trace where funds came from or went. An address that
            received tainted funds but is not itself listed will not be blocked.
          </li>
          <li>
            <strong>EVM addresses only.</strong> The sanctions data used here is the ETH entry set. Other chains and non-EVM
            address formats are not covered by this check.
          </li>
          <li>
            <strong>Lists are incomplete by nature.</strong> A drainer not yet in any published advisory is not in this list.
            Absence of a match is not evidence that a counterparty is safe.
          </li>
          <li>
            <strong>The Circle blacklist covers Base from block {circle.fromBlock ?? "51,000,000"} only.</strong> It is
            enforced for payments on Base, and a hit is a hit, but events below that block are not covered by the free
            RPC: absence from the list proves only that no event was seen in the covered range. The latest{" "}
            <code>Blacklisted</code>/<code>UnBlacklisted</code> event decides the state, so a visible unfreeze is
            reflected; an unfreeze below the coverage start, or one Circle never emitted as an event, is not visible.
          </li>
          <li>
            <strong>Not a compliance product.</strong> This is not screening, onboarding, identity verification or legal
            advice, and using it does not make anyone compliant with any regime. It is one exact-match check against public
            data, with the provenance above so you can judge it yourself.
          </li>
        </ul>
      </section>

      <p className="lp-prose-back">
        Data as of {LISTS.generatedAt}. To verify any figure here, read{" "}
        <code>packages/preflight/src/sanctioned-addresses.ts</code> and <code>known-drainers.ts</code> — the counts are
        generated from them. <Link href="/glossary">Glossary</Link> · <Link href="/">← back to PayStage</Link>
      </p>
    </main>
  );
}
