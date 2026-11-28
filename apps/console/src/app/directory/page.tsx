import type { Metadata } from "next";
import "../landing.css";
import {
  DIRECTORY,
  LISTING_MEANING,
  ORDER_EXPLANATION,
  categoryLabel,
  coverageSentence,
  demandLabel,
  directoryView,
  formatBytes,
  formatPrice,
  resourcePath,
} from "@/lib/directory";

/**
 * `/directory` — the public census of x402 merchants (#497).
 *
 * The table is server-rendered from the committed snapshot and ships no client JavaScript. The three sentences above
 * the table are load-bearing, not decoration: what a listing does and does not mean, where demand comes from and what
 * `not known` means, and the order. Remove any of them and the table reads as an endorsement or a sales chart.
 */
export const metadata: Metadata = {
  title: "x402 merchant directory",
  description:
    "A dated census of x402 resources that answered a correct payment challenge: host, what it sells, quoted price, method, chain, challenge size, first and last verified date, and x402scan demand where the explorer publishes it.",
  robots: { index: true, follow: true },
};

export default function DirectoryPage() {
  const view = directoryView(DIRECTORY);
  const { counts } = DIRECTORY;
  const demandRecipients = new Set(view.rows.flatMap((row) => (row.x402scan ? [row.x402scan.recipient] : []))).size;

  return (
    <main className="lp-wrap lp-prose directory-page">
      <p className="lp-note">
        <a href="/lists">Deny lists and the checked-seller probe</a> · <a href="/directory.json">/directory.json</a> ·{" "}
        <a href="/directory.schema.json">JSON schema</a> ·{" "}
        <a href="https://vouchguard.app/ask">
          One question: would you put a team&apos;s agent spend behind a limit you can see?
        </a>
      </p>

      <h1>x402 merchant directory</h1>

      <p className="lp-lead">
        Every resource below answered a correct x402 payment challenge when PayStage asked — {counts.resources} of the{" "}
        {counts.censusRows} endpoints probed — first on {DIRECTORY.firstVerifiedOn ?? "an unrecorded date"} and last on{" "}
        {DIRECTORY.verifiedOn ?? "an unrecorded date"}, when all {counts.resources} answered a v2 challenge.
      </p>

      <p>
        <strong>{LISTING_MEANING}</strong> It says the endpoint quoted a price, a payTo and a network on that date; it says
        nothing about whether the service is useful, honest, or still answering tomorrow, and it is not an endorsement.
      </p>

      <p>
        <strong>Demand is only shown where x402scan publishes it.</strong> The figures are the explorer&apos;s, captured{" "}
        {DIRECTORY.source.demand?.capturedOn ?? "on no recorded date"}, and they are <em>recipient-level</em>: payments and
        USD value x402scan attributes to the row&apos;s <code>payTo</code> across every resource that pays that address, not
        sales of the resource in the row. Where the <code>payTo</code> has no x402scan match the cell says{" "}
        <strong>not known</strong> — never <code>0</code>.
      </p>

      <p>
        <strong>Do not sum this column.</strong> {demandRecipients} explorer recipients back the {counts.withDemand} rows that
        carry a figure; one recipient can appear on several rows, so adding the cells counts the same payments more than
        once.
      </p>

      <p>{ORDER_EXPLANATION}</p>

      <p className="lp-note">
        <strong>Source.</strong> PayStage&apos;s checked-seller census ({DIRECTORY.source.census.name},{" "}
        {DIRECTORY.source.census.method ?? "method not recorded"}, first verified {DIRECTORY.firstVerifiedOn ?? "undated"},
        last verified {DIRECTORY.verifiedOn ?? "undated"}). Demand: x402scan recipient table,{" "}
        {DIRECTORY.source.demand?.capturedOn ?? "undated"}. Categories are our reading of each URL path and the listing&apos;s
        own description, not the seller&apos;s label. {coverageSentence(DIRECTORY)}
        {view.withheld > 0
          ? ` ${view.withheld} row${view.withheld === 1 ? " is" : "s are"} withheld because it has no verified date or source.`
          : ""}
      </p>

      <h2>Categories</h2>
      <ul className="directory-taxonomy">
        {view.byCategory.map((entry) => (
          <li key={entry.id}>
            <span className="directory-taxonomy-count">{entry.count}</span>{" "}
            <strong>{entry.label}</strong> <span className="lp-note">{entry.definition}</span>
          </li>
        ))}
      </ul>

      <table>
        <caption className="lp-note">
          {counts.resources} resources across {counts.hosts} hosts · {counts.withDemand} with an x402scan demand figure,{" "}
          {counts.withoutDemand} <code>not known</code>.
        </caption>
        <thead>
          <tr>
            <th scope="col">Host</th>
            <th scope="col">What it sells</th>
            <th scope="col">Price</th>
            <th scope="col">Method</th>
            <th scope="col">Chain</th>
            <th scope="col">Challenge</th>
            <th scope="col">First verified</th>
            <th scope="col">Last verified</th>
            <th scope="col">Demand (x402scan)</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.resource}>
              <td>
                <a href={row.resource} rel="noopener">
                  {row.host}
                </a>
                <br />
                <span className="lp-note">{resourcePath(row.resource)}</span>
              </td>
              <td>{categoryLabel(DIRECTORY, row.category)}</td>
              <td>
                {formatPrice(row.priceUsd)} <span className="lp-note">/ {row.priceUnit}</span>
              </td>
              <td>{row.method}</td>
              <td>{row.chain}</td>
              <td>{formatBytes(row.challengeBytes)}</td>
              <td>{row.firstVerifiedOn}</td>
              <td>{row.lastVerifiedOn}</td>
              <td>
                {row.x402scan ? (
                  <>
                    <a href={row.x402scan.url} rel="noopener">
                      {demandLabel(row.x402scan)}
                    </a>
                    <br />
                    <span className="lp-note">
                      {row.x402scan.source}, {row.x402scan.capturedOn}
                    </span>
                  </>
                ) : (
                  <span className="lp-note">not known</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="lp-note">
        Every row links to the live resource; a demand figure links to the x402scan recipient page it came from. The
        machine-readable copy and its schema are at <a href="/directory.json">/directory.json</a> and{" "}
        <a href="/directory.schema.json">/directory.schema.json</a>.
      </p>
    </main>
  );
}
