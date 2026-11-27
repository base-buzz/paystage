import {
  accrualExportHref,
  accrualJsonHref,
  formatMinor,
  type AccrualRange,
  type AccrualRow,
  type AccrualSummary,
} from "@/lib/accrual";

/**
 * The accrual record, server-rendered with no client JavaScript.
 *
 * The row is an accounting object, not a list of calls: period, vendor, cost centre, integer
 * micro-USDC total, count, refusals, the window and the hash of the decisions behind it. The page
 * says where each dimension comes from, because a column with no source is where an accrual starts
 * inventing numbers.
 */
export function AccrualView({
  range,
  rows,
  summary,
}: {
  range: AccrualRange;
  rows: AccrualRow[];
  summary: AccrualSummary;
}) {
  const csvHref = accrualExportHref(range.from, range.to);
  const jsonHref = accrualJsonHref(range.from, range.to);
  const empty = rows.length === 0;

  return (
    <div className="accrual-wrap">
      <header className="accrual-hero">
        <p className="accrual-eyebrow">Lab · #474 · accrual</p>
        <h1>{empty ? "No accrual rows in this range." : "One row per vendor, cost centre and month."}</h1>
        <p className="accrual-lede accrual-lede--hero">
          <strong>{rows.length}</strong> {rows.length === 1 ? "row" : "rows"} over{" "}
          <code>
            {range.fromDay} → {range.toDay}
          </code>
          , from <strong>{summary.settledProduction}</strong> settled payments on Base mainnet and{" "}
          <strong>{summary.refusals}</strong> refusals. Every total is integer micro-USDC; a float never
          touches the arithmetic.
        </p>
        <p className="accrual-link">
          <a href={csvHref}>Download this range as CSV</a>
          {" · "}
          <a href={jsonHref}>the same rows as JSON</a>
        </p>
      </header>

      <p className="accrual-definition" role="note">
        A <strong>cost centre</strong> is the accounting code finance assigns to a vendor in{" "}
        <code>accrual-cost-centres.json</code>; <code>unassigned</code> means finance has not coded
        that vendor yet — it is a real bucket, not a guessed code, and this export never infers one
        from a payment.
      </p>

      <dl className="accrual-facts">
        <div>
          <dt>Settled, mainnet</dt>
          <dd>{summary.settledProduction}</dd>
        </div>
        <div>
          <dt>Resolved to a tenant</dt>
          <dd>{summary.settledResolvedToTenant}</dd>
        </div>
        <div>
          <dt>Without a tenant</dt>
          <dd>{summary.settledWithoutTenant}</dd>
        </div>
        <div>
          <dt>Unpriced settled</dt>
          <dd>{summary.settledUnpriced}</dd>
        </div>
        <div>
          <dt>Refusals</dt>
          <dd>{summary.refusals}</dd>
        </div>
        <div>
          <dt>Other networks</dt>
          <dd>{summary.settledOtherNetwork}</dd>
        </div>
      </dl>

      <section className="accrual-panel" aria-labelledby="accrual-rows">
        <h2 id="accrual-rows">Rows</h2>
        <p className="accrual-note">
          <strong>Vendor</strong> is the lower-cased <code>pay_to</code> address.{" "}
          <code>vendor_not_recorded</code> means the decision carries no <code>pay_to</code> — most
          refusals never reach a payee — so it is a bucket, not a vendor. A settled payment with no
          amount is counted and adds 0: the export does not invent a value.
        </p>
        {empty ? (
          <p className="accrual-empty">No settled payments or refusals in this range, so there is no row.</p>
        ) : (
          <div className="accrual-table-scroll">
            <table className="accrual-table">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Vendor</th>
                  <th scope="col">Cost centre</th>
                  <th scope="col">Total (minor)</th>
                  <th scope="col">Count</th>
                  <th scope="col">Refusals</th>
                  <th scope="col">First → last</th>
                  <th scope="col">Evidence hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.period}|${row.vendor}|${row.cost_centre}`}>
                    <td>
                      <code>{row.period}</code>
                    </td>
                    <td>
                      <code>{row.vendor}</code>
                    </td>
                    <td>
                      <code>{row.cost_centre}</code>
                    </td>
                    <td className="accrual-num">
                      {row.total_minor.toLocaleString("en-US")}
                      <span className="accrual-sub"> = {formatMinor(row.total_minor)} USDC</span>
                    </td>
                    <td className="accrual-num">{row.count}</td>
                    <td className="accrual-num">{row.refusals}</td>
                    <td className="accrual-window">
                      <code>{row.first_ts}</code>
                      <br />→ <code>{row.last_ts}</code>
                    </td>
                    <td>
                      <code className="accrual-hash">{row.evidence_hash}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="accrual-panel" aria-labelledby="accrual-honesty">
        <h2 id="accrual-honesty">What this row is, and what it is not</h2>
        <p className="accrual-note">
          <strong>Money scope.</strong> Only <code>settled</code> decisions on Base mainnet
          (<code>eip155:8453</code>) enter <code>total_minor</code>. Settled payments on other networks
          are counted in the facts above and deliberately excluded from money: testnet USDC is not
          spend, and adding it to mainnet USDC would overstate the month. Refusals are counted on every
          network because the control working is the same fact everywhere. Every mainnet settled
          decision is included whatever its caller provenance: each is a real payment, and provenance
          stays on the per-decision record rather than being hidden from this total.
        </p>
        <p className="accrual-note">
          <strong>No tenant join exists.</strong> <code>events</code> has no mandate serial or tenant
          column and <code>mandates</code> has no payee column, so{" "}
          <strong>{summary.settledResolvedToTenant}</strong> of{" "}
          {summary.settledProduction} settled payments resolve to a tenant. The rest are not assigned
          a guessed tenant; they wait for a cost centre in the mapping file.
        </p>
        <p className="accrual-note">
          <strong>Re-derive the hash.</strong> Take the <code>events.id</code> values behind the row,
          sort them, join with a newline, append one trailing newline, and take the SHA-256. The hex
          in the last column is the result. Duplicate ids are refused, not de-duplicated, because a
          duplicate would be a decision counted twice.
        </p>
        <p className="accrual-note">
          <strong>Reconciliation.</strong> Summing <code>total_minor</code> over these rows equals the
          sum of the underlying mainnet settled amounts; summing <code>count</code> equals the number
          of those settled decisions; summing <code>refusals</code> equals the number of{" "}
          <code>do_not_pay</code> decisions in the range. Nothing is double counted and nothing is
          dropped.
        </p>
      </section>
    </div>
  );
}
