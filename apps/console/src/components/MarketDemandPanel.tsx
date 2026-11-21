import type { CSSProperties } from "react";
import {
  DEMAND_METHOD,
  controlNotice,
  coverageDetail,
  formatCount,
  formatCoverage,
  formatUsdc,
  staleNotice,
  storedMethodLabel,
  type DemandView,
} from "@/lib/market-demand";

/**
 * The demand half of `/lab` (#320): what listed sellers actually receive, and the window it was measured in.
 *
 * The component is deliberately thin — every decision about which row to read, whether it is stale, whether the
 * coverage denominator exists and whether the address filter passed its control is made in
 * `@/lib/market-demand`, where it is tested. This file only renders that view, so it cannot render zeroes over a
 * missing row or a ratio without its method.
 */

const LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div style={LABEL_STYLE}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{value}</div>
      {note ? <div style={{ fontSize: 11.5, opacity: 0.55 }}>{note}</div> : null}
    </div>
  );
}

export function MarketDemandPanel({ view }: { view: DemandView }) {
  if (view.kind === "unreadable") {
    return (
      <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
        <strong>Could not read the demand row.</strong> {view.reason}. No figure is shown, because a failed read is
        not a zero.
      </p>
    );
  }

  if (view.kind === "none") {
    return (
      <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
        <strong>No demand window stored yet.</strong> The collector has not written a <code>market_demand</code> row,
        so there is no figure — and no zeroes, because a zero here would be an invented measurement.
      </p>
    );
  }

  const { snapshot: s, stale } = view;
  const methodNote = storedMethodLabel(s.storedMethod);
  const controlFailed = s.control.status === "failed";

  return (
    <>
      {stale ? (
        <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--lp-amber, #b45309)", lineHeight: 1.6 }}>
          <strong>Stale.</strong> {staleNotice(stale)}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 18, marginTop: 14 }}>
        <Stat
          label="Payee transfers"
          value={formatCount(s.payeeTransfers)}
          note="direct transfers to watched payees"
        />
        <Stat
          label="Value received"
          value={formatUsdc(s.payeeTransfersValueUsdc)}
          note="direct to watched payees"
        />
        <Stat
          label="Chain-wide USDC transfers"
          value={formatCount(s.chainUsdcTransfers)}
          note="baseline, same block window"
        />
        <div>
          <div style={LABEL_STYLE}>Coverage · paid ÷ listed</div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>
            {formatCoverage(s.coverage)}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.55 }}>{coverageDetail(s)}</div>
          {/* Not a tooltip, not optional: the method sits with the ratio in every state. */}
          <p style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 }}>
            <strong>Method:</strong> {DEMAND_METHOD}.
          </p>
          {methodNote ? (
            <p style={{ fontSize: 11.5, margin: "2px 0 0", opacity: 0.55 }}>{methodNote}</p>
          ) : null}
        </div>
        <Stat label="Distinct payers" value={formatCount(s.distinctPayers)} />
        <Stat label="Repeat payers" value={formatCount(s.repeatPayers)} note="more than one transfer" />
        <Stat
          label="Payment size p50 / p90"
          value={`${formatUsdc(s.sizeP50Usdc)} / ${formatUsdc(s.sizeP90Usdc)}`}
          note={s.sizeP50Usdc === null ? "not recorded" : undefined}
        />
        <Stat label="Window" value={`${formatCount(s.windowBlocks)} blocks`} note={s.runDate} />
      </div>

      <p
        style={{
          marginTop: 12,
          fontSize: 13,
          lineHeight: 1.6,
          color: controlFailed ? "var(--lp-amber, #b45309)" : undefined,
          opacity: controlFailed ? 1 : 0.7,
        }}
      >
        {controlNotice(s.control, s.chainUsdcTransfers)}
      </p>

      {s.likelyTestPayers !== null && s.likelyTestPayers > 0 ? (
        <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.6 }}>
          <strong>{formatCount(s.likelyTestPayers)}</strong> of {formatCount(s.distinctPayers)} payer(s) look automated:
          more than ten transfers an hour, or a hundred or more into one payee. <em>Likely-test</em> is not proof of a
          demo, and an unclassified payer is not proof of a customer.
        </p>
      ) : null}
    </>
  );
}
