import {
  formatRange,
  PAYER_NOT_RECORDED,
  PROVENANCE_LABELS,
  REFUSAL_CONTROL_LINE,
  type RefusalView,
} from "@/lib/refusals";
import { decisionExportHref } from "@/lib/decision-export";

/**
 * The refusals record, server-rendered with no client JavaScript.
 *
 * A refusal is a decision, not an error: it belongs beside the payments, not in an incident feed. The page
 * therefore leads with the count and the rule, never with "failed". The only alerting-shaped thing here is a
 * paragraph explaining why there is none.
 */
export function RefusalsView({ view, truncated = false }: { view: RefusalView; truncated?: boolean }) {
  const range = formatRange(view);
  const empty = view.total === 0;

  return (
    <div className="refusals-wrap">
      <header className="refusals-hero">
        <p className="refusals-eyebrow">Lab · #472 · refusals</p>
        <h1>{empty ? "No refusals in this window." : "Refusals, by rule and by payer."}</h1>
        <p className="refusals-lede refusals-lede--hero">
          <strong>{view.total}</strong> refusals (<code>decision = do_not_pay</code>) in the last{" "}
          <strong>{view.days} days</strong>. Range read: <code>{range}</code>.
        </p>
        <p className="refusals-lede">
          A refusal is the policy path doing its job before anything is signed. This page is a record for the
          team that owns the policy — not an alert, a threshold, or a queue. Nothing here pings anyone.
        </p>
        <dl className="refusals-facts">
          <div>
            <dt>Total refusals</dt>
            <dd>{view.total}</dd>
          </div>
          <div>
            <dt>Rules named</dt>
            <dd>{view.rules.length}</dd>
          </div>
          <div>
            <dt>Distinct payers</dt>
            <dd>{view.distinctPayers}</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>{view.days} days</dd>
          </div>
        </dl>
      </header>

      <p className="refusals-control" role="note">
        {REFUSAL_CONTROL_LINE}
      </p>

      <p className="refusals-export">
        <a href={decisionExportHref(view.windowStart, view.windowEnd)}>
          Download every decision in this window as CSV
        </a>{" "}
        — refusals, reviews, payments and failures, one row per decision, with <code>reason_codes</code> or{" "}
        <code>not recorded</code>.
      </p>

      {truncated ? (
        <p className="refusals-caveat">
          This read hit its 5,000-row cap, so the totals below are a floor, not the full window. The page has no
          pagination: widen the window or lower the noise before treating these counts as complete.
        </p>
      ) : null}

      <section className="refusals-panel" aria-labelledby="refusals-rules">
        <h2 id="refusals-rules">By rule</h2>
        <p className="refusals-note">
          <code>reason_codes</code> is where the rule lives. A row may name more than one rule, so these counts
          can exceed the refusal total; an empty list is shown as <code>{`not recorded`}</code>, never filled
          with a guess.
        </p>
        {view.rules.length === 0 ? (
          <p className="refusals-empty">No refusals in this window, so there is no rule to rank.</p>
        ) : (
          <table className="refusals-table">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Refusals</th>
              </tr>
            </thead>
            <tbody>
              {view.rules.map((row) => (
                <tr key={row.label}>
                  <td>
                    <code>{row.label}</code>
                  </td>
                  <td className="refusals-num">{row.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Rule mentions</th>
                <td className="refusals-num">{view.ruleTotal}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {view.ruleCaveat === null ? null : <p className="refusals-caveat">{view.ruleCaveat}</p>}
      </section>

      <section className="refusals-panel" aria-labelledby="refusals-payers">
        <h2 id="refusals-payers">By payer</h2>
        <p className="refusals-note">
          Addresses are masked to six and four characters. We group by the wallet that paid or attempted the
          payment, not by a person; the table does not claim to know who is behind an address.
        </p>
        {view.payers.length === 0 ? (
          <p className="refusals-empty">No refusals in this window, so there is no payer to group.</p>
        ) : (
          <table className="refusals-table">
            <thead>
              <tr>
                <th scope="col">Payer</th>
                <th scope="col">Refusals</th>
              </tr>
            </thead>
            <tbody>
              {view.payers.map((row) => (
                <tr key={row.label}>
                  <td>
                    {row.label === PAYER_NOT_RECORDED ? (
                      <em>{row.label}</em>
                    ) : (
                      <code>{row.label}</code>
                    )}
                  </td>
                  <td className="refusals-num">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.payerCaveat === null ? null : <p className="refusals-caveat">{view.payerCaveat}</p>}
      </section>

      <section className="refusals-panel refusals-panel--provenance" aria-labelledby="refusals-provenance">
        <h2 id="refusals-provenance">Provenance</h2>
        <p className="refusals-note">
          Provenance is recorded, not inferred. The project&apos;s labels are{" "}
          {PROVENANCE_LABELS.map((label, index) => (
            <span key={label}>
              {index === 0 ? "" : index === PROVENANCE_LABELS.length - 1 ? " and " : ", "}
              <code>{label}</code>
            </span>
          ))}
          ; a row that does not prove one is <code>unknown-agent</code>. The table still stores the older{" "}
          <code>events.source</code> path value, and the finer #430 caller label lives in{" "}
          <code>caller_provenance</code>. We print both raw values below instead of relabelling them.
        </p>
        <div className="refusals-provenance-grid">
          <div>
            <h3>
              <code>events.source</code>
            </h3>
            {view.sources.length === 0 ? (
              <p className="refusals-empty">No rows.</p>
            ) : (
              <table className="refusals-table refusals-table--compact">
                <thead>
                  <tr>
                    <th scope="col">Value</th>
                    <th scope="col">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {view.sources.map((row) => (
                    <tr key={row.label}>
                      <td>
                        <code>{row.label}</code>
                      </td>
                      <td className="refusals-num">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3>Mapped to the four labels</h3>
            {view.provenance.length === 0 ? (
              <p className="refusals-empty">No rows.</p>
            ) : (
              <table className="refusals-table refusals-table--compact">
                <thead>
                  <tr>
                    <th scope="col">Provenance</th>
                    <th scope="col">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {view.provenance.map((row) => (
                    <tr key={row.label}>
                      <td>
                        <code>{row.label}</code>
                      </td>
                      <td className="refusals-num">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <footer className="refusals-footer">
        <p>
          Source: <code>public.events</code>, decision <code>do_not_pay</code>, window {view.days} days. Read
          on the server at request time; no client script, no chart library, no threshold.
        </p>
        <p>
          {empty
            ? "An empty window is a fact, not a failure: nothing was refused, so there is nothing to show."
            : "For the record: nothing on this page is a failed payment."}
        </p>
      </footer>
    </div>
  );
}
