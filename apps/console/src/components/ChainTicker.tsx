"use client";

import { useEffect, useState } from "react";

/**
 * Base mainnet, ticking.
 *
 * This is the one moving thing on the page that is nobody's marketing: block height and gas price are
 * Base's, and they advance whether or not anyone uses PayStage. That is exactly why it can be shown
 * without implying activity — and it is labelled as public chain data, not as our traffic.
 *
 * Served from our own endpoint with a 3-second cache, so a thousand visitors cost one upstream call.
 */
type Snapshot = { block: number | null; gasGwei: number | null; ok: boolean; note?: string };

export function ChainTicker() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const res = await fetch("/v1/public/chain.json", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Snapshot;
        if (alive) {
          setSnap(body);
          setFailed(false);
        }
      } catch {
        // A failed poll shows as failed, not as a frozen number. A stale block height that looks live
        // is worse than an honest gap.
        if (alive) setFailed(true);
      }
    }

    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (failed) {
    return (
      <div className="lp-chain" aria-live="polite">
        <span className="lp-chain-label">base mainnet</span>
        <span className="lp-chain-value">unreachable</span>
        <span className="lp-chain-note">our proxy could not reach the public RPC — not a chain stall</span>
      </div>
    );
  }

  if (!snap) {
    return (
      <div className="lp-chain" aria-live="polite">
        <span className="lp-chain-label">base mainnet</span>
        <span className="lp-chain-value">connecting…</span>
      </div>
    );
  }

  return (
    <div className="lp-chain" aria-live="polite">
      <span className="lp-chain-label">base mainnet</span>
      <span className="lp-chain-value">
        block <strong>{snap.block?.toLocaleString() ?? "—"}</strong>
      </span>
      <span className="lp-chain-value">
        gas <strong>{snap.gasGwei ?? "—"}</strong> gwei
      </span>
      {/* The label is not decoration: this is the chain's activity, not ours. */}
      <span className="lp-chain-note">public chain data · not our traffic</span>
    </div>
  );
}
