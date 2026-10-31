import type { ReactNode } from "react";
import { getMetrics } from "@/lib/metrics";
import { StatusStrip } from "@/components/StatusStrip";
import { IssueFlags } from "@/components/IssueFlags";
import { VolumeChart } from "@/components/VolumeChart";
import { EventFeed } from "@/components/EventFeed";
import { IncidentFeed } from "@/components/IncidentFeed";

export const dynamic = "force-dynamic";

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          lineHeight: 1.1,
          color: accent ?? "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export default async function Page() {
  const m = await getMetrics();

  const status = {
    ok: m.issuesOpen === 0,
    uptime_pct: m.uptimePct,
    flags: m.flags,
    updated_at: m.generatedAt,
  };

  return (
    <main
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "20px 20px 48px",
        display: "grid",
        gap: 16,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            PayStage Console
          </h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "2px 0 0" }}>
            Operational telemetry · generated{" "}
            {new Date(m.generatedAt).toISOString().slice(0, 19).replace("T", " ")}Z
          </p>
        </div>
        {!m.configured ? (
          <span className="badge badge-test">Telemetry not configured</span>
        ) : null}
      </header>

      <StatusStrip status={status} />

      {!m.configured ? (
        <div
          className="panel"
          style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}
        >
          Supabase is not configured. Set{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> (server only) to load
          telemetry. Public status flags are still fetched from{" "}
          <code>NEXT_PUBLIC_STATUS_URL</code>.
        </div>
      ) : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <Metric
          label="Real calls · 24h"
          value={m.realCount24h.toLocaleString()}
          accent="var(--good)"
          sub={
            m.syntheticCount24h > 0 ? (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <span className="badge badge-synth">synthetic</span>
                {m.syntheticCount24h.toLocaleString()} excluded
              </span>
            ) : (
              "no synthetic traffic"
            )
          }
        />
        <Metric
          label="Issues open"
          value={String(m.issuesOpen)}
          accent={m.issuesOpen > 0 ? "var(--warn)" : "var(--text)"}
          sub={m.issuesOpen > 0 ? "see flags below" : "all clear"}
        />
        <Metric
          label="Uptime"
          value={m.uptimePct != null ? `${m.uptimePct.toFixed(2)}%` : "—"}
          sub={m.uptimePct != null ? "public status" : "placeholder"}
        />
      </section>

      <IssueFlags flags={m.flags} />

      <VolumeChart data={m.volume} />

      <EventFeed events={m.events} />

      <IncidentFeed incidents={m.incidents} />
    </main>
  );
}
