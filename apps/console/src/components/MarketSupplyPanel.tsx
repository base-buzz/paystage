import type { CSSProperties } from "react";
import {
  buildPayeeDelta,
  buildSeries,
  concentrationOf,
  concentrationNotice,
  payeeDeltaAddresses,
  payeeDeltaSummary,
  topPayees,
} from "@/lib/market-series";
import type { MarketSupplyRow } from "@/lib/market-demand";

/**
 * Supply's top-10 payees table and concentration line (#322).
 *
 * `top_payees` is a catalogue claim: the collector aggregates the ten addresses with the most accepts that day. The
 * table renders exactly those rows and the concentration sentence names the denominator — the row's own `accepts`
 * total for the same date — so "X% of accepts" cannot be read as a share of anything the catalogue did not measure.
 *
 * The payee column shows an address, not an identity, and the note under the table says so.
 */

const LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function PayeeAddressLine({ label, addresses }: { label: string; addresses: string[] }) {
  if (addresses.length === 0) {
    return (
      <p style={{ margin: "2px 0 0", fontSize: 12.5, opacity: 0.75 }}>
        {label}: none.
      </p>
    );
  }
  const { shown, more } = payeeDeltaAddresses(addresses);
  return (
    <p style={{ margin: "2px 0 0", fontSize: 12.5, lineHeight: 1.7, opacity: 0.85 }}>
      {label}:{" "}
      {shown.map((address, index) => (
        <span key={address}>
          {index > 0 ? ", " : ""}
          <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5 }} title={address}>
            {address}
          </code>
        </span>
      ))}
      {more > 0 ? ` +${more.toLocaleString("en-US")} more` : ""}
    </p>
  );
}

export function MarketSupplyPanel({ rows, reason }: { rows: MarketSupplyRow[]; reason: string | null }) {
  if (reason !== null) {
    return (
      <p style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.6 }}>
        <strong>Could not read the catalogue.</strong> {reason}. The top-10 table and its concentration line are not
        shown, because a failed read is not an empty catalogue.
      </p>
    );
  }

  // One row per date, newest write wins; the table always describes the newest catalogue row, even if that row's
  // concentration is unreadable. Falling back to an older row for the table would put two dates in one block.
  const series = buildSeries(rows, () => 1);
  const row = series.latest?.row ?? null;
  if (row === null) {
    return (
      <p style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.6 }}>
        <strong>No catalogue row stored yet.</strong> There is no top-10 table to show, and no concentration share —
        neither is zero.
      </p>
    );
  }

  const top = topPayees(row);
  const payeeDelta = buildPayeeDelta(rows, row);
  const accepts = Number(row.accepts);
  const runDate = String(row.run_date);

  return (
    <>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline", marginTop: 14 }}>
        <div>
          <div style={LABEL_STYLE}>Top-10 concentration · accepts</div>
          <div style={{ fontSize: 26, fontWeight: 620, lineHeight: 1.2 }}>
            {concentrationOf(row) === null ? "—" : `${(concentrationOf(row)! * 100).toFixed(2)}%`}
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, maxWidth: 560, opacity: 0.75 }}>
          {concentrationNotice(row)}
        </p>
      </div>

      {top.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, opacity: 0.75 }}>
          This row stores no readable <code>top_payees</code>, so there is no table and the concentration line has no
          numerator. That is missing data, not a market with no payees.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.6 }}>
              <th style={{ padding: "6px 8px" }}>#</th>
              <th style={{ padding: "6px 8px" }}>payee</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>accepts</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>resources</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>hosts</th>
            </tr>
          </thead>
          <tbody>
            {top.map((payee, index) => (
              <tr key={payee.payee} style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
                <td style={{ padding: "6px 8px", opacity: 0.55 }}>{index + 1}</td>
                <td
                  style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                  title={payee.payee}
                >
                  {shortAddress(payee.payee)}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{payee.accepts.toLocaleString("en-US")}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{payee.resources.toLocaleString("en-US")}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{payee.hosts.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(128,128,128,0.25)" }}>
        <div style={LABEL_STYLE}>Payee turnover · since the previous consecutive day</div>
        {payeeDelta.comparable ? (
          <>
            <p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.55 }}>
              <strong>{payeeDeltaSummary(payeeDelta)}</strong>
            </p>
            <PayeeAddressLine label="New" addresses={payeeDelta.newPayees} />
            <PayeeAddressLine label="Gone" addresses={payeeDelta.gonePayees} />
            <p style={{ margin: "6px 0 0", fontSize: 11.5, opacity: 0.55, lineHeight: 1.5 }}>
              Matched on the exact payee strings the catalogue returned. A walk that lost a page, or an address the
              catalogue re-cased, would show up here as new or gone; the set is only as complete as that day&apos;s
              catalogue read.
            </p>
          </>
        ) : (
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6 }}>
            <strong>no comparable day</strong> — {payeeDelta.reason}. New and gone payees are not counted across a
            missing day.
          </p>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11.5, opacity: 0.55, lineHeight: 1.5 }}>
        Read {runDate}; {Number.isFinite(accepts) ? accepts.toLocaleString("en-US") : "?"} accepts in the catalogue
        that day. A payee is an address the catalogue lists, not an identified seller. A listing is a seller&apos;s
        claim; we have not paid these endpoints.
      </p>
    </>
  );
}
