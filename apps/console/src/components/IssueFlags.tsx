import type { StatusFlag } from "@/lib/types";

const severityColor: Record<StatusFlag["severity"], string> = {
  info: "var(--accent)",
  minor: "var(--warn)",
  major: "var(--warn)",
  critical: "var(--bad)",
};

export function IssueFlags({ flags }: { flags: StatusFlag[] }) {
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
          Issue flags
        </h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {flags.length} active
        </span>
      </header>

      {flags.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          No active flags.
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
          {flags.map((f) => (
            <li
              key={f.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--panel-2)",
                borderLeft: `3px solid ${severityColor[f.severity]}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                {f.detail ? (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {f.detail}
                  </div>
                ) : null}
              </div>
              <span className="badge">{f.severity}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
