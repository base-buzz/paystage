import { formatMinorUsdc, rollupUrl, type RollupRead } from "@/lib/rollup";

/**
 * One division total (#471) on the page a team lead uses (`/lab/refusals`).
 *
 * It renders the endpoint's body and nothing else. When `spend_unavailable_reason` is present the
 * panel shows **no number** — not "$0.00" — because the endpoint's zero means "the join does not
 * exist", and a currency figure would turn that into "no money moved". The same rule applies to
 * refusals. This is the one design decision the component exists to enforce.
 *
 * Server-rendered, no client JavaScript: a total that needs a second fetch to explain itself is a
 * total that can be screenshotted without its caveat.
 */
export function RollupDivisionTotal({ state }: { state: RollupRead }) {
  if (state.kind === "unreadable") {
    return (
      <section className="division-total division-total--unreadable" aria-labelledby="division-total-title">
        <p className="refusals-eyebrow">Division total · #471 · unreadable</p>
        <h2 id="division-total-title">The division total could not be read.</h2>
        <p className="division-total__reason">
          {state.reason}. No figure is shown: an unreadable roll-up and a division that spent nothing are
          different facts.
        </p>
        <p className="division-total__source">
          Endpoint: <code>{rollupUrl(state.unit, state.apiBase)}</code>
        </p>
      </section>
    );
  }

  const payload = state.payload;
  const spendUnavailable = payload.spend_unavailable_reason !== undefined;
  const refusalsUnavailable = payload.refusals_unavailable_reason !== undefined;

  return (
    <section className="division-total" aria-labelledby="division-total-title">
      <p className="refusals-eyebrow">Division total · #471 · from the roll-up endpoint</p>
      <h2 id="division-total-title">
        <code>{payload.unit}</code> and every unit under it
      </h2>

      {spendUnavailable ? (
        <>
          <p className="division-total__value division-total__value--unavailable">Spend not computed</p>
          <p className="division-total__reason">{payload.spend_unavailable_reason}</p>
        </>
      ) : (
        <p className="division-total__value">
          {formatMinorUsdc(payload.spend_minor)} <span>USDC</span>
        </p>
      )}

      <dl className="division-total__facts">
        <div>
          <dt>Mandates</dt>
          <dd>{payload.mandates}</dd>
        </div>
        <div>
          <dt>Refusals</dt>
          <dd>{refusalsUnavailable ? "not attributed" : payload.refusals}</dd>
        </div>
        <div>
          <dt>Child units</dt>
          <dd>{payload.descendants.length}</dd>
        </div>
        <div>
          <dt>Read at</dt>
          <dd>{payload.as_of}</dd>
        </div>
      </dl>

      {refusalsUnavailable ? (
        <p className="division-total__reason">{payload.refusals_unavailable_reason}</p>
      ) : null}

      {payload.spend_unpriced_settled !== undefined ? (
        <p className="division-total__reason">
          {payload.spend_unpriced_settled} settled {payload.spend_unpriced_settled === 1 ? "payment has" : "payments have"}{" "}
          no recorded amount and are counted but not priced.
        </p>
      ) : null}

      {payload.descendants.length > 0 ? (
        <ul className="division-total__children">
          {payload.descendants.map((child) => (
            <li key={child.unit}>
              <code>{child.unit}</code>
              <span>
                {child.mandates} {child.mandates === 1 ? "mandate" : "mandates"}
                {spendUnavailable ? "" : ` · ${formatMinorUsdc(child.spend_minor)} USDC`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="division-total__reason">
          No child unit carries a mandate yet. The count above is this unit&apos;s own mandates; an empty
          tree is a real state on a single-person install.
        </p>
      )}

      <p className="division-total__source">
        Rendered from <code>{rollupUrl(payload.unit, state.apiBase)}</code>. Totals are integer
        micro-USDC; a float never touches the arithmetic.
      </p>
    </section>
  );
}
