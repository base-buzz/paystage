"use client";

import { useState } from "react";
import { SCENARIOS, type Scenario } from "@/lib/scenarios";
import { PaidSepolia } from "./PaidSepolia";

interface Result {
  id: string;
  tool: string;
  decision: string;
  reasons: unknown[];
  detail: unknown;
}

function decisionClass(decision: string): string {
  if (decision === "pay" || decision === "allow" || decision === "ok")
    return "decision decision-allow";
  if (
    decision === "do_not_pay" ||
    decision === "deny" ||
    decision === "revoke_recommended" ||
    decision === "do_not_trade"
  )
    return "decision decision-block";
  if (decision === "review") return "decision decision-review";
  if (decision === "error") return "decision decision-error";
  return "decision";
}

export function ScenarioRunner() {
  const [active, setActive] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(s: Scenario) {
    setActive(s.id);
    setError(null);
    setResult(null);
    if (s.tool === "paid-sepolia") return;
    setLoading(true);
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: s.id }),
      });
      const data = (await res.json()) as Result | { error: string };
      if (!res.ok || "error" in data) {
        setError(
          "error" in data ? data.error : `HTTP ${res.status}`,
        );
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request_failed");
    } finally {
      setLoading(false);
    }
  }

  const activeScenario = SCENARIOS.find((s) => s.id === active) ?? null;

  return (
    <section aria-labelledby="scenarios-heading" className="panel" style={{ padding: 16 }}>
      <h2 id="scenarios-heading" className="panel-title">
        Scenarios
      </h2>
      <p className="panel-sub">
        One click each. Offline policy fixtures — no mainnet calls.
      </p>
      <div className="scenario-grid" role="group" aria-label="Scenario fixtures">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="scenario-btn"
            onClick={() => run(s)}
            aria-pressed={active === s.id}
            disabled={loading && active === s.id}
          >
            <span className="scenario-label">{s.label}</span>
            <span className="scenario-tool">{s.tool}</span>
            <span className="scenario-desc">{s.description}</span>
          </button>
        ))}
      </div>

      {activeScenario?.tool === "paid-sepolia" ? (
        <div className="scenario-output">
          <PaidSepolia />
        </div>
      ) : null}

      {loading ? (
        <p className="muted" role="status">
          Running…
        </p>
      ) : null}
      {error ? (
        <p className="decision decision-error" role="alert">
          Error: {error}
        </p>
      ) : null}
      {result ? (
        <div className="scenario-output" aria-live="polite">
          <div className={decisionClass(result.decision)}>
            <strong>{result.decision}</strong>
            <span className="muted"> · {result.tool}</span>
          </div>
          {result.reasons?.length ? (
            <ul className="reason-list">
              {result.reasons.map((r, i) => (
                <li key={i}>{typeof r === "string" ? r : JSON.stringify(r)}</li>
              ))}
            </ul>
          ) : null}
          {result.detail != null ? (
            <details className="detail-block">
              <summary>Detail</summary>
              <pre>{JSON.stringify(result.detail, null, 2)}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
