import {
  CHECKED_SELLERS,
  challengeLabel,
  checkedSellerView,
  checkedSellersCoverage,
  checkedSellersDenominators,
  checkedSellersDialects,
  checkedSellersGap,
  checkedSellersMethod,
  checkedSellersMethodSplit,
  checkedSellersOversize,
  checkedSellersSummaries,
  formatCheckedCalls,
  priceMatchLabel,
  screeningLabel,
  verifiedLabel,
  withheldRowsNote,
  type CheckedSellersSnapshot,
} from "@/lib/checked-sellers";

/**
 * The checked-seller table (#372).
 *
 * Rows come from the generated record; the method paragraph and every count are built from that record, not typed here.
 * `checkedSellerView` withholds any row the record cannot date or method, and the count of withheld rows is shown rather
 * than hidden — a table of checks that silently drops an unfinished row is the failure mode this section exists to
 * avoid.
 *
 * The copy around the table is deliberately explicit that this is not a ranking of quality and not an endorsement: a
 * host answering a correct 402 at the advertised price is a fact about the endpoint on one day, not a statement that
 * paying it is safe.
 */

const CARD_STYLE = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(128,128,128,0.25)",
  fontSize: 12.5,
  lineHeight: 1.5,
} as const;

export function CheckedSellersPanel({ snapshot = CHECKED_SELLERS }: { snapshot?: CheckedSellersSnapshot }) {
  const view = checkedSellerView(snapshot);

  return (
    <section aria-labelledby="checked-sellers-heading">
      <h2 id="checked-sellers-heading">Checked sellers — the top of the catalogue, probed</h2>
      <p>
        A read-only probe of the highest-call endpoints in Bazaar&apos;s discovery index: did the endpoint answer a
        correct 402, did it charge the price it advertised, and was its payee on our lists? <strong>This is not a
        ranking of quality and not an endorsement.</strong> It is not the verified-payee registry above, and no row here
        was added to it. A correct challenge says the endpoint quoted a price and a payee; it says nothing about whether
        the service is honest, useful, or still answering tomorrow. Where the record does not carry a per-host answer,
        the cell says so rather than filling it from a run total.
      </p>

      <p>
        <strong>Method.</strong> {checkedSellersMethod(snapshot)}
      </p>

      <p>
        <strong>POST-only resources.</strong> {checkedSellersMethodSplit(snapshot)}
      </p>

      <p style={{ marginTop: 10 }}>
        <strong>Challenge dialects.</strong> {checkedSellersDialects(snapshot)}
      </p>

      <p style={{ marginTop: 10 }}>
        <strong>Two denominators.</strong> {checkedSellersDenominators(snapshot)}
      </p>

      <p style={{ marginTop: 10 }}>
        <strong>Header size.</strong> {checkedSellersOversize(snapshot)}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 10,
          margin: "12px 0",
        }}
      >
        {checkedSellersSummaries(snapshot).map((summary) => (
          <div key={summary} style={CARD_STYLE}>
            {summary}
          </div>
        ))}
      </div>

      <p className="lp-list-caption">{checkedSellersCoverage(snapshot)}</p>

      <table>
        <thead>
          <tr>
            <th>Host</th>
            <th>Calls / 30d</th>
            <th>Verified</th>
            <th>Correct 402</th>
            <th>Advertised price</th>
            <th>Screening</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.host} title={`Method: ${row.method}; verified ${verifiedLabel(row)}`}>
              <td>{row.host}</td>
              <td>{formatCheckedCalls(row.calls30d)}</td>
              <td>{verifiedLabel(row)}</td>
              <td>{challengeLabel(row)}</td>
              <td>{priceMatchLabel(row)}</td>
              <td>{screeningLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="lp-list-caption">
        Prices are read from <code>accepts[].amount</code>. A resource whose price shape we do not recognise is{" "}
        <strong>unknown</strong>, not <code>$0</code>: it is left out of the price comparison rather than counted as free.
      </p>

      {view.withheld > 0 ? (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--lp-amber, #b45309)" }}>
          {withheldRowsNote(view.withheld)}
        </p>
      ) : null}

      <p>
        <strong>Why two columns say &quot;not recorded&quot;.</strong> {checkedSellersGap(snapshot)}
      </p>
      <p className="lp-list-caption">
        The verified date is the date of the probe run, not the date this page was built. Absence from this table means
        unchecked, not cleared: a host that is not named here was outside the sampled top 100, and it is not accused of
        anything. The rows are generated from the research record by <code>scripts/gen-checked-sellers.mjs</code>; the
        build fails when the committed copy drifts.
      </p>
    </section>
  );
}
