import { Panel } from "@/components/soak/Panel";
import { formatEth, formatInt } from "@/lib/soak-mesh";
import type { SoakProjection } from "@/lib/soak-mesh-types";

export function ValueFlowPanel({ projection }: { projection: SoakProjection }) {
  const { totals, window } = projection;
  const conserved = totals.differenceMicro === 0 && totals.payerMicro === totals.amountMicro && totals.payeeMicro === totals.amountMicro;

  return (
    <Panel
      index={4}
      id="value"
      title="Value flow"
      question="Does anything get created or destroyed?"
      proves="the payment loop conserves: summing the same rows by payer, by payee, or as raw rows yields the same integer micro-total, to the last unit."
      doesNot="that the value serves anyone. Equal totals are an accounting identity, not evidence of demand."
      source={projection.source}
      windowStart={window.start}
      windowEnd={window.end}
    >
      <p className="mesh-lede">
        The two sums below are computed independently from the same {formatInt(totals.payments)} rows. One adds every
        payer's total; the other adds every payee's total. Nothing is netted, rounded or apportioned. The assertion is the
        panel: if the two numbers disagreed, the page would be wrong and this line would say so.
      </p>

      <div className="mesh-value-flow">
        <div className="mesh-value-side">
          <span className="mesh-value-label">Outflows · payer totals</span>
          <strong>{formatEth(totals.payerMicro)} ETH</strong>
          <span className="mesh-value-sub">{formatInt(totals.payers)} payers · Σ each payer&apos;s total</span>
        </div>
        <div className="mesh-value-middle" aria-hidden="true">
          <span className="mesh-value-line" />
          <span className="mesh-value-arrow">→</span>
          <span className="mesh-value-line" />
        </div>
        <div className="mesh-value-side">
          <span className="mesh-value-label">Inflows · payee totals</span>
          <strong>{formatEth(totals.payeeMicro)} ETH</strong>
          <span className="mesh-value-sub">{formatInt(totals.payees)} payees · Σ each payee&apos;s total</span>
        </div>
      </div>

      <dl className="mesh-value-facts">
        <div>
          <dt>Σ row amounts</dt>
          <dd>{formatEth(totals.amountMicro)} ETH</dd>
        </div>
        <div>
          <dt>Difference (inflows − outflows)</dt>
          <dd className={conserved ? "mesh-value-pass" : "mesh-value-fail"}>
            {formatEth(Math.abs(totals.differenceMicro))} ETH {conserved ? "· conserved" : "· NOT conserved"}
          </dd>
        </div>
        <div>
          <dt>Payments</dt>
          <dd>{formatInt(totals.payments)}</dd>
        </div>
        <div>
          <dt>Mean / min / max payment</dt>
          <dd>
            {formatEth(totals.meanMicro)} / {formatEth(totals.minMicro)} / {formatEth(totals.maxMicro)} ETH
          </dd>
        </div>
      </dl>

      <p className="mesh-value-assertion">
        Assertion: Σ outflows = {formatEth(totals.payerMicro)} ETH · Σ inflows = {formatEth(totals.payeeMicro)} ETH · Σ rows ={" "}
        {formatEth(totals.amountMicro)} ETH · all three equal, difference {formatEth(Math.abs(totals.differenceMicro))} ETH. The
        checker recomputes this from the snapshot rows; it does not trust the totals this page renders.
      </p>
    </Panel>
  );
}
