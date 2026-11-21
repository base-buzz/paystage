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

type ReviewPacket = {
  schema: string;
  amount: {
    value: string;
    symbol: string;
    atomic: string;
    share: { of: string | null; denominator: string; ratio: string };
  };
  payee: { address: string; network: string; asset: string; symbol: string; origin?: string };
  rule: string;
  checked: string[];
  not_checked: string[];
  decision: { question: string; options: string[] };
};

const FIELD_LABEL = {
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  opacity: 0.55,
};

const MONO = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12.5,
  lineHeight: 1.5,
};

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

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
    detail: "500 USDC against a 0.10 USDC policy ceiling",
    expect: "do_not_pay",
  },
  {
    id: "needs_human",
    label: "Needs a human",
    detail: "0.06 USDC — over the 0.05 USDC human-approval threshold",
    expect: "review",
  },
] as const;

export function TryConsole({ from }: { from?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(scenario: string) {
    setBusy(scenario);
    setResult(null);
    try {
      const res = await fetch("/api/try", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario, from }),
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

  const packet =
    result?.response && typeof result.response === "object"
      ? (result.response as { packet?: ReviewPacket }).packet
      : undefined;

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
          {decision === "review" && packet !== undefined && (
            <section
              style={{
                marginTop: 18,
                border: "1px solid rgba(127,127,127,0.28)",
                borderRadius: 12,
                padding: 18,
              }}
            >
              <div style={{ ...FIELD_LABEL, marginBottom: 12 }}>
                Review packet — a person has to decide
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 18,
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                }}
              >
                <div>
                  <div style={FIELD_LABEL}>Amount</div>
                  <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>
                    {packet.amount.value} {packet.amount.symbol}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>
                    {packet.amount.share.ratio} of {packet.amount.share.denominator}
                    {packet.amount.share.of ? ` (${packet.amount.share.of})` : ""}
                  </div>
                </div>
                <div>
                  <div style={FIELD_LABEL}>Payee</div>
                  <div style={{ ...MONO, fontSize: 14 }}>{shortAddress(packet.payee.address)}</div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>
                    {packet.payee.network} · {packet.payee.symbol}
                    {packet.payee.origin ? ` · ${packet.payee.origin}` : ""}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={FIELD_LABEL}>Rule that fired</div>
                  <div style={MONO}>{packet.rule}</div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 18,
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  marginTop: 18,
                }}
              >
                <div>
                  <div style={FIELD_LABEL}>Checked</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                    {packet.checked.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div style={FIELD_LABEL}>Not checked</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                    {packet.not_checked.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  padding: 12,
                  borderRadius: 10,
                  background: "rgba(127,127,127,0.09)",
                }}
              >
                <div style={FIELD_LABEL}>Decision</div>
                <div style={{ fontSize: 16 }}>{packet.decision.question}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {packet.decision.options.map((option) => (
                    <code
                      key={option}
                      style={{
                        ...MONO,
                        padding: "2px 8px",
                        border: "1px solid rgba(127,127,127,0.3)",
                        borderRadius: 6,
                      }}
                    >
                      {option}
                    </code>
                  ))}
                </div>
              </div>
            </section>
          )}

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
