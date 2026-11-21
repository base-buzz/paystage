import type { ChannelCounts } from "@/lib/channel-counts";
import { unknownSentence } from "@/lib/channel-counts";

/**
 * `/lab` — which listing actually sent anyone (#326).
 *
 * The unknown row is rendered as its own table row, not folded into a total or a percentage. The panel is allowed to
 * say the read failed; it is not allowed to draw a zero for a read that did not happen, because "no channel" and
 * "could not read channels" are different facts.
 */
export function ChannelAttributionPanel({
  counts,
  reason,
  windowLabel,
  truncated,
}: {
  counts: ChannelCounts | null;
  reason: string | null;
  windowLabel: string;
  truncated?: boolean;
}) {
  const total = counts?.total ?? 0;

  return (
    <section style={{ marginTop: 28, padding: 18, borderRadius: 12, border: "1px solid var(--lp-line, #6b7280)" }}>
      <h2 style={{ fontSize: 15, margin: 0, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.65 }}>
        Which channel sent anyone
      </h2>

      {reason !== null ? (
        <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--lp-amber, #b45309)" }}>
          Could not read <code>events</code>: {reason} The counts are absent, not zero.
        </p>
      ) : counts === null || total === 0 ? (
        <p style={{ marginTop: 12, fontSize: 13.5, opacity: 0.7 }}>
          No events carried a channel in {windowLabel}. That is an empty window, not evidence that no listing sent
          anyone: an absent <code>?from=</code> is recorded as unknown, and unknown has its own row below.
        </p>
      ) : null}

      {counts !== null && total > 0 ? (
        <>
          <p style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
            {unknownSentence(counts)}{" "}
            {truncated
              ? "This is the newest slice of the window, not every event in it — the counts are a floor."
              : "Counted from real events only; synthetic and test traffic is excluded."}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.6 }}>
                <th style={{ padding: "6px 8px" }}>channel</th>
                <th style={{ padding: "6px 8px" }}>events</th>
                <th style={{ padding: "6px 8px" }}>share</th>
              </tr>
            </thead>
            <tbody>
              {counts.channels.map((row) => (
                <tr key={row.channel ?? "unknown"} style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
                  <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>
                    {row.channel}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{row.count.toLocaleString("en-US")}</td>
                  <td style={{ padding: "6px 8px", opacity: 0.75 }}>{Math.round((row.count / total) * 100)}%</td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
                <td style={{ padding: "6px 8px", fontStyle: "italic", opacity: 0.8 }}>unknown channel</td>
                <td style={{ padding: "6px 8px" }}>{counts.unknown.toLocaleString("en-US")}</td>
                <td style={{ padding: "6px 8px", opacity: 0.75 }}>{Math.round((counts.unknown / total) * 100)}%</td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: 10, fontSize: 12.5, opacity: 0.6 }}>
            The signal is the <code>?from=</code> parameter on a URL that points at PayStage, stored at first contact. No IP, user
            agent or referrer URL is read for this column.
          </p>
        </>
      ) : null}
    </section>
  );
}
