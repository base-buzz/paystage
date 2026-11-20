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

const DEFAULT_CHAIN_ENDPOINT = "https://api.paystage.xyz/v1/public/chain.json";

/**
 * The endpoint arrives as a prop, resolved by the server component that mounts this.
 *
 * It used to read `process.env.NEXT_PUBLIC_CHAIN_ENDPOINT` here, which is the same defect that produced
 * React #418 in SiweStub on 2026-11-20: a `NEXT_PUBLIC_` variable is inlined by Next only when it is set at
 * build time, and this Worker sets its variables at request time — so the server could read one value and
 * the browser another. A prop cannot disagree with itself.
 */
export function ChainTicker({ endpoint = DEFAULT_CHAIN_ENDPOINT }: { endpoint?: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        // The endpoint lives on the API host, not the site host. Calling the relative path asked the
        // console Worker for a route it does not have, so the strip read "unreachable" on a page that
        // was working perfectly — a wrong URL that looked exactly like an outage.
        const res = await fetch(endpoint, { cache: "no-store" });
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
        block <strong>{snap.block?.toLocaleString("en-US") ?? "—"}</strong>
      </span>
      <span className="lp-chain-value">
        gas <strong>{snap.gasGwei ?? "—"}</strong> gwei
      </span>
      {/* The label is not decoration: this is the chain's activity, not ours. */}
      <span className="lp-chain-note">public chain data · not our traffic</span>
    </div>
  );
}
