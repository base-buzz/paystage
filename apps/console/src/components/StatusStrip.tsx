import type { PublicStatus } from "@/lib/types";

export function StatusStrip({ status }: { status: PublicStatus | null }) {
  const ok = status?.ok ?? false;
  const uptime =
    status?.uptime_pct != null ? `${status.uptime_pct.toFixed(2)}%` : "—";
  const updated = status?.updated_at
    ? new Date(status.updated_at).toUTCString()
    : "unknown";

  return (
    <div
      className="panel"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        fontSize: 13,
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: ok ? "var(--good)" : "var(--bad)",
            boxShadow: `0 0 8px ${ok ? "var(--good)" : "var(--bad)"}`,
          }}
        />
        <strong style={{ fontWeight: 600 }}>
          {ok ? "All systems operational" : "Degraded / unknown"}
        </strong>
        <span style={{ color: "var(--muted)" }}>· public status</span>
      </div>
      <div style={{ display: "flex", gap: 16, color: "var(--muted)" }}>
        <span>
          Uptime <span style={{ color: "var(--text)" }}>{uptime}</span>
        </span>
        <span>Updated {updated}</span>
      </div>
    </div>
  );
}
