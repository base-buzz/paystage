import {
  CHECKED_SELLERS_SEGMENT,
  segmentCorrectLabel,
  segmentKillCriterion,
  segmentMethod,
  segmentPayeeLabel,
  segmentPriceLabel,
  segmentScreeningLabel,
  segmentSelfDescription,
  segmentSummaries,
  type SegmentSnapshot,
} from "@/lib/checked-sellers-segment";
import { formatCount } from "@/lib/market-demand";

/**
 * The first named segment on `/lists` (#398): the 55 hosts whose listings describe uncensored/private inference.
 *
 * It sits **ahead of** the top-of-catalogue checked-seller list, because it is a named class with its own denominator,
 * not a slice of the call ranking. The table keeps the same columns as the general list; the asked price and the payee
 * are carried in the "Advertised price" and "Screening" cells and in the row title rather than as new columns.
 *
 * The copy says three things and none is optional: membership is self-description; the measurement is payment safety,
 * not content policy; and the kill criterion that decides the headline is stated with its result.
 */
const CARD_STYLE = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(128,128,128,0.25)",
  fontSize: 12.5,
  lineHeight: 1.5,
} as const;

export function UncensoredInferenceSegmentPanel({ snapshot = CHECKED_SELLERS_SEGMENT }: { snapshot?: SegmentSnapshot }) {
  return (
    <section aria-labelledby="uncensored-segment-heading">
      <h2 id="uncensored-segment-heading">
        First segment — the &quot;uncensored inference&quot; class, {formatCount(snapshot.denominator.hosts)} hosts by
        self-description
      </h2>
      <p>{segmentSelfDescription(snapshot)}</p>

      <p>
        <strong>Method.</strong> {segmentMethod(snapshot)}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 10,
          margin: "12px 0",
        }}
      >
        {segmentSummaries(snapshot).map((summary) => (
          <div key={summary} style={CARD_STYLE}>
            {summary}
          </div>
        ))}
      </div>

      <p>{segmentKillCriterion(snapshot)}</p>

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
          {snapshot.rows.map((row) => (
            <tr
              key={row.host}
              title={`${row.endpoint} — method: ${row.method}; payee: ${segmentPayeeLabel(row)}`}
            >
              <td>{row.host}</td>
              <td>{formatCount(row.calls30d)}</td>
              <td>{row.verifiedOn}</td>
              <td>{segmentCorrectLabel(row)}</td>
              <td>{segmentPriceLabel(row)}</td>
              <td>{segmentScreeningLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="lp-list-caption">
        One endpoint per host: the matching entry with the highest 30-day call count, tie-broken by the lowest Base-USDC
        amount and then by URL. &quot;Calls / 30d&quot; is that chosen entry&apos;s own count, not a host total. The
        payee shown in the screening title is the one the challenge asked to be paid, not the catalogue&apos;s advertised
        payee. Colour and popularity are not evidence of safety, and a cleared payee is not an endorsement of the
        service.
      </p>
    </section>
  );
}
