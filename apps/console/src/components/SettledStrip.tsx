import { selectRows, isSupabaseConfigured } from "@/lib/supabase";

/**
 * What has actually settled on this endpoint — including the uncomfortable part.
 *
 * Today the answer is "four calls, all ours". That is shown rather than hidden: a number that only
 * moves when money moves is worth more than a busy-looking widget, and the age counting *up* is the
 * most honest thing on the page when nobody is paying.
 *
 * Server-side, with the service key, on a 30-second revalidate. The public browser key cannot read
 * this table (see supabase/migrations/20261114050000_events_private.sql).
 */
type SettledRow = { amount_usdc: number | string | null; ts: string; source: string };

async function loadSettled() {
  if (!isSupabaseConfigured()) return null;
  const rows = await selectRows<SettledRow>(
    "events",
    "select=amount_usdc,ts,source&decision=eq.settled&order=ts.desc&limit=500",
  );
  return rows;
}

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

export async function SettledStrip() {
  const rows = await loadSettled();

  const settled = rows ?? [];
  const total = settled.reduce((sum, r) => sum + Number(r.amount_usdc ?? 0), 0);
  const external = settled.filter((r) => r.source === "real").length;
  const ours = settled.length - external;
  const last = settled[0]?.ts;

  return (
    <div className="lp-settled">
      <span className="lp-settled-item">
        settled on this endpoint <strong>{settled.length}</strong>
      </span>
      <span className="lp-settled-item">
        <strong>{total.toFixed(3)}</strong> USDC
      </span>
      <span className="lp-settled-item">
        from outside <strong>{external}</strong>
      </span>
      <span className="lp-settled-item">
        <strong>{ours}</strong> ours
      </span>
      {last && <span className="lp-settled-item">last {ago(last)}</span>}
      {/* The label does the work that a spinner cannot: it says whose money this is. */}
      <span className="lp-settled-note">
        {external === 0
          ? "no external payer yet — every settlement above is our own test traffic"
          : "external settles counted only when a real payer address signed the receipt"}
      </span>
    </div>
  );
}
