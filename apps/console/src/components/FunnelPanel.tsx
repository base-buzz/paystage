"use client";

import { useEffect, useState } from "react";

/**
 * Where a stranger stops.
 *
 * "Unique payers" answers *did anyone pay*. This answers *where did the rest stop*, which is the only
 * shape that tells us what to fix. Three observations from the same 24-hour window — a challenge
 * served, a verdict asked for, a settlement recorded — rendered as three bars rather than a headline
 * counter, because the gap between them is the finding.
 *
 * The stages are not a strict chain and the caption says so: an agent can settle without ever calling
 * the evaluator, so a taller settle bar is not a contradiction.
 */
type Funnel = { challenges: number; evaluations: number; settles: number };

const STAGES: Array<{ key: keyof Funnel; label: string; hint: string }> = [
  { key: "challenges", label: "paid challenges served", hint: "a 402 the caller chose to answer" },
  { key: "evaluations", label: "verdicts asked for", hint: "pay · review · do_not_pay" },
  { key: "settles", label: "settled", hint: "on-chain, receipt issued" },
];

export function FunnelPanel() {
  const [funnel, setFunnel] = useState<Funnel | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setFunnel(j?.funnel ?? null))
      .catch(() => alive && setFunnel(null));
    return () => {
      alive = false;
    };
  }, []);

  if (!funnel) return null;
  const max = Math.max(funnel.challenges, funnel.evaluations, funnel.settles, 1);

  return (
    <div className="lp-funnel" role="img" aria-label="24-hour funnel: challenges, verdicts and settlements">
      <div className="lp-funnel-head">
        <span>last 24 hours</span>
        <span className="lp-funnel-note">counts, not a chain — an agent can settle without asking for a verdict</span>
      </div>
      <div className="lp-funnel-bars">
        {STAGES.map((stage) => {
          const value = funnel[stage.key];
          const pct = Math.round((value / max) * 100);
          return (
            <div className="lp-funnel-row" key={stage.key}>
              <span className="lp-funnel-label">
                {stage.label}
                <span className="lp-funnel-hint">{stage.hint}</span>
              </span>
              <span className="lp-funnel-track">
                <span className={`lp-funnel-fill lp-funnel-${stage.key}`} style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%` }} />
              </span>
              <span className="lp-funnel-value">{value.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
