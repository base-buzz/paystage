import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";
import { LISTS } from "@/lib/lists.generated";

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
    "The sanctions and drainer lists PayStage checks before a payment is allowed: sources, retrieval and last-change dates, counts, refresh cadence and the limits of exact-address matching.",
};

const ageDays = (iso: string): number => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const changedLabel = (fields: readonly string[]): string =>
  fields.length === 2 ? "last-modified and body" : fields.join(" and ");

export default function ListsPage() {
  const ofac = LISTS.ofac;
  // `lists.generated.ts` is emitted `as const`; today's snapshot has no recorded change, so `null` would otherwise be
  // narrowed to `never` and the "a change may arrive later" branch would not type-check.
  const ofacLastChangeAt = ofac.lastChangeAt as string | null;
  const ofacLastChangeFields = ofac.lastChangeFields as readonly string[];
  const ofacFirstFetchedAt = ofac.firstFetchedAt as string | null;
  const drainers = LISTS.drainers;
  const sinks = LISTS.nonReceivable;
  const ofacAge = ageDays(ofac.retrieved);
  // An old retrieval is only stale if the upstream body moved. The detector proves "unchanged" with a body hash; when
  // that proof is absent (no snapshot), fall back to the age window rather than assuming the list is current.
  const ofacStale = ofacAge > ofac.maxAgeDays && ofac.changedSinceCopy !== false;
  const total = ofac.addresses + drainers.addresses + sinks.addresses;

  return (
    <main className="lp-wrap lp-prose">
      <h1>Deny lists</h1>
      <p className="lp-lead">
        Every payment this product evaluates is checked against {total} addresses across three lists before it can be allowed.
        Each list, who publishes it, when this copy was retrieved, when its upstream feed last changed, and what the check does and does not mean is below. The
        figures are generated from the code that runs, so they cannot drift from what is shipped.
      </p>

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
          {drainers.addresses} addresses compiled from {drainers.sources.length} sources, each entry carrying the advisory or
          dataset it came from. The curation policy and extension process live in the repository; the sources below are the
          record of where each address originated.
        </p>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Retrieved</th>
            </tr>
          </thead>
          <tbody>
            {drainers.sources.map((s) => (
              <tr key={s.url}>
                <td>
                  <a href={s.url} rel="noreferrer noopener" target="_blank">
                    {s.name}
                  </a>
                </td>
                <td>{s.retrieved}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>These are review dates, not an upstream last-change.</strong> The drainer list is curated from the sources
          below; it has no publisher feed to watch, so there is no last-modified date to hash and no honest way to state
          one. A change is noticed when a source is re-read, not on a schedule. That gap is a missing discovery mechanism,
          not a claim that nothing changed.
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
