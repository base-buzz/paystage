"use client";

import { useState } from "react";

type Result = {
  scenario: string;
  status: number;
  latencyMs: number;
  verdictHeader?: string | null;
  response?: unknown;
  error?: string;
};

const SCENARIOS = [
  {
    id: "allowed",
    label: "Allowed payment",
    detail: "0.002 USDC to an allow-listed payee, under the cap",
    expect: "pay",
  },
  {
    id: "unknown_payee",
    label: "Unknown payee",
    detail: "Right amount, wrong address — the case a spend cap cannot catch",
    expect: "do_not_pay",
  },
  {
    id: "over_cap",
    label: "Over the cap",
    detail: "500 USDC against a 0.05 USDC policy ceiling",
    expect: "do_not_pay",
  },
] as const;

export function TryConsole() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(scenario: string) {
    setBusy(scenario);
    setResult(null);
    try {
      const res = await fetch("/api/try", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      setResult((await res.json()) as Result);
    } catch (error) {
      setResult({
        scenario,
        status: 0,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  const decision =
    result?.response && typeof result.response === "object"
      ? ((result.response as { decision?: string }).decision ?? "—")
      : "—";

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {SCENARIOS.map((s) => (
          <div
            key={s.id}
            style={{
              border: "1px solid rgba(127,127,127,0.25)",
              borderRadius: 10,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <strong style={{ fontSize: 15 }}>{s.label}</strong>
            <span style={{ fontSize: 13, opacity: 0.7, minHeight: 34 }}>{s.detail}</span>
            <button
              type="button"
              onClick={() => run(s.id)}
              disabled={busy !== null}
              style={{
                marginTop: "auto",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(127,127,127,0.35)",
                background: busy === s.id ? "rgba(127,127,127,0.15)" : "transparent",
                cursor: busy === null ? "pointer" : "default",
                fontSize: 14,
              }}
            >
              {busy === s.id ? "Running…" : "Run it"}
            </button>
          </div>
        ))}
      </div>

      {result && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong style={{ fontSize: 18 }}>
              verdict:{" "}
              <code
                style={{
                  color: decision === "do_not_pay" ? "#b4232a" : decision === "pay" ? "#1a7f3c" : "inherit",
                }}
              >
                {decision}
              </code>
            </strong>
            <span style={{ opacity: 0.65, fontSize: 13 }}>
              HTTP {result.status || "—"} · {result.latencyMs} ms
              {result.verdictHeader ? ` · free tier: ${result.verdictHeader}` : ""}
            </span>
          </div>
          {result.error && <p style={{ color: "#b4232a", fontSize: 14 }}>{result.error}</p>}
          <pre
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 10,
              background: "rgba(127,127,127,0.08)",
              overflowX: "auto",
              fontSize: 12.5,
              lineHeight: 1.45,
            }}
          >
            {JSON.stringify(result.response ?? result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
