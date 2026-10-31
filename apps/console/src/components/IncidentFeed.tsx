import type { Incident } from "@/lib/types";

const severityColor: Record<Incident["severity"], string> = {
  info: "var(--accent)",
  minor: "var(--warn)",
  major: "var(--warn)",
  critical: "var(--bad)",
};

export function IncidentFeed({ incidents }: { incidents: Incident[] }) {
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
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Incidents</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {incidents.length} total
        </span>
      </header>

      {incidents.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          No incidents recorded.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: 8,
          }}
        >
          {incidents.map((i) => (
            <li
              key={i.id}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--panel-2)",
                borderLeft: `3px solid ${severityColor[i.severity]}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{i.title}</span>
                <span className="badge">{i.status}</span>
              </div>
              {i.summary ? (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {i.summary}
                </div>
              ) : null}
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                {new Date(i.created_at).toUTCString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
