import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";
import {
  MATRIX,
  countOutcomes,
  outcomeOf,
  rowsMostlyUnassessed,
  staleCells,
  summaryLine,
  type Cell,
} from "@/lib/wallet-matrix";
import { FOUNDATION_TABLE_URL, FOUNDATION_UTILITIES } from "@/lib/foundation-utilities";

/**
 * `/compare` — the wallet matrix (#366), rendered entirely from
 * `docs/state/comparisons/wallets.json`.
 *
 * The rule that makes it publishable is not the table: it is that every mark carries its own source and
 * the date that source was read, and a cell nobody confirmed says `unassessed` instead of pretending to be
 * a no. `check-comparison-freshness` fails CI on an unsourced mark or a read date older than 90 days, and
 * this page prints the same warning when a build carries stale data.
 *
 * No logos: the monograms come from the data file and are the same plain-text device `/lists` uses.
 */
export const metadata: Metadata = {
  title: "Wallet matrix",
  description:
    "What a payer's wallet can and cannot do against a payment gate, row by capability, with a source and read date in every assessed cell and unassessed where nobody confirmed the answer.",
  alternates: { canonical: "https://paystage.xyz/compare" },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function CellView({ cell }: { cell: Cell }) {
  if (cell === "unassessed") {
    return <span className="lp-compare-unassessed">unassessed</span>;
  }
  const label = cell.mark === "yes" ? "yes" : cell.mark === "no" ? "no" : "not applicable";
  return (
    <span className={`lp-compare-cell lp-compare-${cell.mark}`}>
      <span className="lp-compare-mark" aria-hidden="true">
        {cell.mark === "yes" ? "✓" : cell.mark === "no" ? "✗" : "–"}
      </span>
      <span className="lp-compare-label">{label}</span>
      <a
        className="lp-compare-source"
        href={cell.source}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`Source for this ${label} mark: ${hostOf(cell.source)}, read ${cell.readDate}`}
      >
        source<span className="lp-compare-source-host"> · {hostOf(cell.source)}</span>
        <span className="lp-compare-date"> · read {cell.readDate}</span>
      </a>
    </span>
  );
}

export default function ComparePage() {
  const counts = countOutcomes(MATRIX);
  const mostlyUnassessed = rowsMostlyUnassessed(MATRIX);
  const stale = staleCells(MATRIX, Date.now());
  const payStage = "PayStage";

  return (
    <main className="lp-wrap lp-prose">
      <p className="lp-eyebrow">COMPARISON · PAYER WALLETS · THE GATE</p>
      <h1>{MATRIX.title}</h1>
      <p className="lp-lead">
        {MATRIX.rows.length} capabilities across {MATRIX.columns.length} products. Every mark below was read by
        opening the linked page on the date beside it; a cell nobody confirmed is <code>unassessed</code>, not a
        no. {summaryLine(counts)}
      </p>

      {stale.length > 0 ? (
        <p className="lp-compare-warning" role="status">
          <strong>This table has aged out.</strong> {stale.length} sourced cell
          {stale.length === 1 ? " is" : "s are"} older than the 90-day window: {stale.slice(0, 3).join("; ")}
          {stale.length > 3 ? `; and ${stale.length - 3} more` : ""}. Re-read the sources before relying on them.
        </p>
      ) : null}

      <div className="lp-compare-legend" aria-label="How to read a cell">
        <span className="lp-compare-cell lp-compare-yes">
          <span className="lp-compare-mark" aria-hidden="true">✓</span> yes — the source says it does this
        </span>
        <span className="lp-compare-cell lp-compare-no">
          <span className="lp-compare-mark" aria-hidden="true">✗</span> no — the source says it does not
        </span>
        <span className="lp-compare-unassessed">unassessed — no source we opened answers the question</span>
      </div>

      <div className="lp-compare-scroll">
        <table className="lp-compare-table">
          <caption>
            Dated capability matrix. Read {MATRIX.computedOn}. Each mark links to the page it came from and the
            date it was read.
          </caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              {MATRIX.columns.map((column) => (
                <th scope="col" key={column} className={column === payStage ? "lp-compare-paystage" : undefined}>
                  <span className="lp-compare-monogram" aria-hidden="true">
                    {MATRIX.columnMeta[column]?.monogram ?? column.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="lp-compare-column-name">{column}</span>
                  <span className="lp-compare-role">{MATRIX.columnMeta[column]?.role}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.rows.map((row) => (
              <tr key={row.capability} className={row.shaded ? "lp-compare-shaded" : undefined}>
                <th scope="row">
                  <span className="lp-compare-capability">{row.capability}</span>
                  <span className="lp-compare-definition">{row.definition}</span>
                  {row.shaded ? <span className="lp-compare-shaded-label">the argument</span> : null}
                </th>
                {MATRIX.columns.map((column) => (
                  <td
                    key={column}
                    className={column === payStage ? "lp-compare-paystage" : undefined}
                    data-outcome={outcomeOf(row.cells[column])}
                  >
                    <CellView cell={row.cells[column] ?? "unassessed"} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="lp-compare-note">
        <strong>Trademarks.</strong> {MATRIX.notes.trademark}
      </p>
      <p className="lp-compare-note">
        <strong>Products change.</strong> {MATRIX.notes.productsChange} This table was read on{" "}
        <strong>{MATRIX.computedOn}</strong>; a mark is evidence for that day, not a permanent description.
      </p>

      <section aria-labelledby="counts-heading">
        <h2 id="counts-heading">The counts, including the blanks</h2>
        <p>
          A comparison that reports only its yes marks hides its own uncertainty. The row below is the same data
          as the table, counted by outcome.
        </p>
        <table className="lp-compare-counts">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">yes</th>
              <th scope="col">no</th>
              <th scope="col">na</th>
              <th scope="col">unassessed</th>
              <th scope="col">cells</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.columns.map((column) => (
              <tr key={column}>
                <th scope="row">
                  {MATRIX.columnMeta[column]?.monogram ?? column.slice(0, 2).toUpperCase()} · {column}
                </th>
                <td>{counts[column].yes}</td>
                <td>{counts[column].no}</td>
                <td>{counts[column].na}</td>
                <td>{counts[column].unassessed}</td>
                <td>{counts[column].total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="blanks-heading">
        <h2 id="blanks-heading">What the blanks mean</h2>
        <p>{MATRIX.notes.unassessed}</p>
        <p>
          {mostlyUnassessed.length} of {MATRIX.rows.length} rows are unassessed in at least three of the four
          columns: {mostlyUnassessed.map((row) => row.capability).join(" · ")}. Those are not rows where the
          products were measured and failed. They are rows where their documentation does not answer the
          question — and a mark invented to fill that gap would be the least defensible cell on the page.
        </p>
      </section>

      <section aria-labelledby="utilities-heading">
        <h2 id="utilities-heading">The other utilities in the Foundation&apos;s table</h2>
        <p>
          The x402 Foundation&apos;s third-party utilities table lists the entries below in this lane. We read each
          project&apos;s own documentation on 24 November 2026. Each row states what it does that we do not, and what
          we do that it does not. Cells marked <code>unassessed</code> are questions their documentation does not
          answer — a documentation gap, not a finding that the check is missing.
        </p>
        <div className="lp-compare-scroll">
          <table className="lp-compare-table lp-utility-table">
            <caption>
              Read 24 November 2026 from the Foundation&apos;s table and each project&apos;s own documentation. The
              name in each row links to that project&apos;s docs.
            </caption>
            <thead>
              <tr>
                <th scope="col">Tool</th>
                <th scope="col">It does this that we do not</th>
                <th scope="col">We do this that it does not</th>
              </tr>
            </thead>
            <tbody>
              {FOUNDATION_UTILITIES.map((tool) => (
                <tr key={tool.name}>
                  <th scope="row">
                    <a className="lp-utility-name" href={tool.url} target="_blank" rel="noreferrer noopener">
                      {tool.name}
                    </a>
                    <span className="lp-utility-date">read {tool.readDate}</span>
                  </th>
                  <td>{tool.theirs}</td>
                  <td>{tool.ours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="lp-compare-note">
          <strong>What we are not.</strong> We are not a monitoring service, an uptime or delivery oracle, a wallet, a
          facilitator or a seller. A <code>pay</code> verdict means the payment matched your policy; it does not mean
          the seller will deliver.
        </p>
        <p className="lp-compare-note">
          <a href={FOUNDATION_TABLE_URL} target="_blank" rel="noreferrer noopener">
            The Foundation&apos;s third-party utilities table
          </a>{" "}
          is the list this section answers. Every description above is the project&apos;s own wording or a direct
          paraphrase, with the date it was read.
        </p>
      </section>

      <section aria-labelledby="own-column-heading">
        <h2 id="own-column-heading">PayStage&apos;s own column</h2>
        <p>
          The {payStage} cells are answered from this repository, not from marketing copy. The evaluator is{" "}
          <code>packages/preflight/src/evaluate.ts</code>; the receipt format is{" "}
          <code>docs/specs/receipt-spec.md</code>; the licence is <code>LICENSE</code>. Every one of those files
          is public, and the marks link to the file that supports them.
        </p>
        <p>{MATRIX.notes.velocity}</p>
        <p>{MATRIX.notes.receipt}</p>
      </section>

      <section aria-labelledby="appendix-heading">
        <h2 id="appendix-heading">Appendix — the conflict</h2>
        <p className="lp-compare-conflict">{MATRIX.notes.conflict}</p>
        <p>
          That is why the shaded row exists. It is not a score for any company; it is the structural condition
          the rest of the table is about. The gate&apos;s claim is narrow: it is a third party to the payment,
          so it can say no without losing the fee that a yes would earn.
        </p>
      </section>

      <section aria-labelledby="method-heading">
        <h2 id="method-heading">Method and freshness</h2>
        <p>
          The data is <code>docs/state/comparisons/wallets.json</code>. Every assessed cell is{" "}
          <code>{`{ mark, source, readDate }`}</code>; every other cell is the literal string{" "}
          <code>&quot;unassessed&quot;</code>. A checker fails on an unsourced mark — including an unsourced{" "}
          <code>no</code> — a missing or future date, or a read date older than 90 days. The page renders the
          same warning when a build carries an aged row, so a green check is not the only guard.
        </p>
        <p>
          A <code>no</code> is a positive claim about absence, so it needs a source as much as a <code>yes</code>{" "}
          does. The product pages linked here are the vendors&apos; own documentation; none of them was read
          through a secondary summary.
        </p>
      </section>

      <p className="lp-prose-back">
        Data read {MATRIX.computedOn}. <Link href="/why">Why an independent adjudicator</Link> ·{" "}
        <Link href="/lists">Deny lists</Link> · <Link href="/glossary">Glossary</Link> ·{" "}
        <Link href="/">← PayStage</Link>
      </p>
    </main>
  );
}
