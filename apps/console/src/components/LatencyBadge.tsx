"use client";

import { useEffect, useState } from "react";

/**
 * The evaluation latency, measured rather than claimed.
 *
 * This used to be a hardcoded "~40 ms". The real p50 was 185 ms when an adversarial review checked it —
 * not a lie, just a number nobody had re-measured since it was written. Reading it removes the class of
 * error: a measurement cannot go stale on the page while it is being displayed.
 */
type Latency = { n: number; p50: number; p90: number };

export function LatencyBadge() {
  const [lat, setLat] = useState<Latency | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/charts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setLat(j?.latency ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!lat) return <span title="measuring…">latency —</span>;

  return (
    <span title={`p50 over ${lat.n} evaluations in the last 7 days; p90 ${lat.p90} ms`}>
      p50 {lat.p50} ms
    </span>
  );
}
