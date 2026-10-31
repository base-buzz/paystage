import { getMetrics } from "@/lib/metrics";
import { StatusStrip } from "@/components/StatusStrip";
import { IssueFlags } from "@/components/IssueFlags";
import { VolumeChart } from "@/components/VolumeChart";
import { EventFeed } from "@/components/EventFeed";
import { IncidentFeed } from "@/components/IncidentFeed";
import { ScenarioRunner } from "@/components/ScenarioRunner";
import { ProgressStrip } from "@/components/ProgressStrip";
import { SiweStub } from "@/components/SiweStub";

export const dynamic = "force-dynamic";

export default async function Page() {
  const m = await getMetrics();

  const status = {
    ok: m.issuesOpen === 0,
    uptime_pct: m.uptimePct,
    flags: m.flags,
    updated_at: m.generatedAt,
  };

  // Real is the headline; keep test/synth in feed with badges.
  const feed = [...m.events].sort((a, b) => {
    const rank = (s: string) => (s === "real" ? 0 : s === "synthetic" ? 1 : 2);
    return rank(a.source) - rank(b.source);
  });

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand">PayStage</div>
        <nav aria-label="External links" className="site-nav">
          <a
            href="https://github.com/base-buzz/paystage"
            className="link"
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@paystage/mcp"
            className="link"
            rel="noopener noreferrer"
            target="_blank"
          >
            npm
          </a>
        </nav>
      </header>
      <main id="main" className="site-main">
        <ScenarioRunner />

        <StatusStrip status={status} />
        <IssueFlags flags={m.flags} />

        <div>
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 13,
              marginBottom: 8,
              padding: "0 4px",
            }}
          >
            <span>
              <strong style={{ color: "var(--good)" }}>{m.realCount24h}</strong>{" "}
              <span className="muted">real / 24h (headline)</span>
            </span>
            <span>
              <strong style={{ color: "var(--synth)" }}>
                {m.syntheticCount24h}
              </strong>{" "}
              <span className="muted">synthetic</span>
            </span>
            <span>
              <strong style={{ color: "var(--warn)" }}>{m.testCount24h}</strong>{" "}
              <span className="muted">test</span>
            </span>
          </div>
          <EventFeed events={feed} />
        </div>

        <ProgressStrip />
        <VolumeChart data={m.volume} />
        <IncidentFeed incidents={m.incidents} />
        <SiweStub />
      </main>
    </>
  );
}
