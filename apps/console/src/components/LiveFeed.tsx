"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { LIVE_FEED } from "@/lib/live-feed";

/**
 * One line that moves when something happens on the endpoint.
 *
 * A real settlement and a synthetic probe look different on purpose: the label is the point. This
 * project's rule is that synthetic traffic is never presented as a customer, and a pulsing light is
 * the easiest place in the whole product to break that rule by accident.
 */
type FeedRow = {
  id: string;
  tool: string;
  decision: string;
  source: string;
  created_at: string;
};

const LOOK: Record<string, { label: string; color: string }> = {
  real: { label: "settled", color: "#6ee7b7" },
  synthetic: { label: "synthetic", color: "#8bb4ff" },
  test: { label: "test", color: "#9aa0b0" },
  "free-tier": { label: "free tier", color: "#9aa0b0" },
};

export function LiveFeed() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [pulse, setPulse] = useState(false);
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const client = createClient(LIVE_FEED.url, LIVE_FEED.key, {
      realtime: { params: { eventsPerSecond: 5 } },
    });

    // Seed with the last few so the line is not empty before the first event, then stream.
    void client
      .from(LIVE_FEED.table)
      .select("id,tool,decision,source,created_at")
      .order("created_at", { ascending: false })
      .limit(4)
      .then(({ data }) => { if (data) setRows(data as FeedRow[]); });

    const channel = client
      .channel("events_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: LIVE_FEED.table },
        (payload) => {
          const row = payload.new as FeedRow;
          setRows((prev) => [row, ...prev].slice(0, 6));
          setPulse(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setPulse(false), 1400);
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void client.removeChannel(channel);
    };
  }, []);

  const latest = rows[0];

  return (
    <section className="lp-live" aria-label="Live activity">
      <div className="lp-wrap lp-live-inner">
        <div className="lp-live-head">
          <span className={`lp-live-dot${pulse ? " is-pulsing" : ""}${connected ? "" : " is-offline"}`} aria-hidden="true" />
          <span className="lp-live-title">
            {latest ? "last call" : "waiting for the first call"}
            {!connected && " · offline"}
          </span>
        </div>
        {latest ? (
          <p className="lp-live-row">
            <code>{latest.tool}</code>
            <span className="lp-live-decision">{latest.decision}</span>
            <span
              className="lp-live-source"
              style={{ color: LOOK[latest.source]?.color ?? "#9aa0b0" }}
            >
              {LOOK[latest.source]?.label ?? latest.source}
            </span>
            <span className="lp-live-ago">{new Date(latest.created_at).toISOString().slice(11, 19)}Z</span>
          </p>
        ) : (
          <p className="lp-live-row lp-live-empty">nothing yet — the feed shows every evaluation, labelled</p>
        )}
        <p className="lp-live-note">
          Every call, labelled by origin. <strong>synthetic</strong> is our own testing; a real payment
          shows as <strong>settled</strong>. Nothing here is a customer count.
        </p>
      </div>
    </section>
  );
}
