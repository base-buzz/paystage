"use client";

import { useEffect, useState } from "react";

/**
 * What has actually settled on this endpoint — including the uncomfortable part.
 *
 * Client-side on purpose. Rendered as an async server component it added incremental regeneration to
 * the lander, and a static page with ISR needs a cache binding the console Worker does not have — which
 * produced a 500 on the apex in production and a clean 200 locally. Fetching from the browser keeps the
 * page fully static, and the worst case is a missing strip rather than a dead homepage.
 *
 * Today the numbers read "all ours". That is shown rather than hidden: a figure that only moves when
 * money moves is worth more than a busy-looking widget.
 */
type Totals = {
  configured?: boolean;
  settled?: number;
  totalUsdc?: number;
  external?: number;
  ours?: number;
  last?: string | null;
  error?: string;
};

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SettledStrip() {
  const [data, setData] = useState<Totals | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/settled", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j))
      .catch(() => alive && setData({ error: "unreachable" }));
    return () => {
      alive = false;
    };
  }, []);

  // Nothing until there is something true to say.
  if (!data || data.configured === false || data.error || typeof data.settled !== "number") return null;

  const external = data.external ?? 0;

  return (
    <div className="lp-settled">
      <span className="lp-settled-item">
        settled on this endpoint <strong>{data.settled}</strong>
      </span>
      <span className="lp-settled-item">
        <strong>{(data.totalUsdc ?? 0).toFixed(3)}</strong> USDC
      </span>
      <span className="lp-settled-item">
        from outside <strong>{external}</strong>
      </span>
      <span className="lp-settled-item">
        <strong>{data.ours ?? 0}</strong> ours
      </span>
      {data.last && <span className="lp-settled-item">last {ago(data.last)}</span>}
      {/* The label does the work a spinner cannot: it says whose money this is. */}
      <span className="lp-settled-note">
        {external === 0
          ? "no external payer yet — every settlement above is our own test traffic"
          : "external settles counted only when a real payer address signed the receipt"}
      </span>
    </div>
  );
}
