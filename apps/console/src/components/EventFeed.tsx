import type { TelemetryEvent } from "@/lib/types";

function basescanUrl(network: string | null, tx: string): string {
  const n = (network ?? "").toLowerCase();
  const host = n.includes("84532") || n.includes("sepolia")
    ? "https://sepolia.basescan.org"
    : "https://basescan.org";
  return `${host}/tx/${tx}`;
}

function sourceBadge(source: TelemetryEvent["source"]) {
  if (source === "real") return <span className="badge badge-real">real</span>;
  if (source === "synthetic")
    return <span className="badge badge-synth">synthetic</span>;
  return <span className="badge badge-test">test</span>;
}

export function EventFeed({ events }: { events: TelemetryEvent[] }) {
  return (
    <section className="panel" style={{ padding: 16 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          Event feed
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {events.length} recent
        </span>
      </header>

      {events.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          No events in the last 24h.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: 6,
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {events.map((e) => (
            <li
              key={e.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 10,
                alignItems: "center",
                padding: "6px 8px",
                borderRadius: 6,
                background: "var(--panel-2)",
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {sourceBadge(e.source)}
                <span style={{ color: "var(--muted)" }}>{e.kind}</span>
              </div>
              <div
                style={{
                  color: "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.route ?? e.message ?? "—"}
              </div>
              <div style={{ display: "flex", gap: 10, color: "var(--muted)" }}>
                <span
                  style={{
                    color:
                      e.status === "ok" || e.status === "success"
                        ? "var(--good)"
                        : e.status === "error" || e.status === "failed"
                          ? "var(--bad)"
                          : "var(--muted)",
                  }}
                >
                  {e.status}
                </span>
                <span>{e.latency_ms != null ? `${e.latency_ms}ms` : "—"}</span>
                {e.tx_hash ? (
                  <a
                    className="link"
                    href={basescanUrl(e.route, e.tx_hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ minHeight: "auto", fontSize: 12 }}
                  >
                    tx
                  </a>
                ) : null}
                <span>{new Date(e.created_at).toISOString().slice(11, 19)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
