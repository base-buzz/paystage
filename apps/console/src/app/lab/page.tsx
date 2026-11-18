import type { Metadata } from "next";
import "../landing.css";
import { isSupabaseConfigured, selectRows } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * /lab — the daily probe results.
 *
 * Unlinked and noindex: it is public because a trend anyone can check is worth more than a screenshot,
 * but it is not a marketing page and should not be in a sitemap or an agent-facing list.
 *
 * Read path: SERVER ONLY. `probe_runs` has RLS on with no policy, so the anon key reads zero rows. Every
 * read below goes through `selectRows`, which uses the service key server-side; if this page is ever
 * converted to a client component or given an API route that uses the anon key, it will silently render
 * "never run" instead of failing. Keeping `payload` out of the props is deliberate for the same reason —
 * it is unbounded jsonb and nothing here needs it.
 */
export const metadata: Metadata = {
  title: "Lab — probe results",
  description: "Daily probe results: how findable PayStage is, and what agents decide when asked to pay.",
  robots: { index: false, follow: false },
};

type ProbeRow = {
  probe: string;
  run_at: string;
  headline: string | null;
  summary: Record<string, unknown> | null;
};

const PROBES: Array<{ id: string; label: string; question: string }> = [
  {
    id: "discovery",
    label: "Discovery",
    question: "Does an agent searching for the need — not our name — find us?",
  },
  {
    id: "decision",
    label: "Decision",
    question: "Asked to pay a stranger's 402 challenge, what does each agent decide?",
  },
];

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

async function latest(probe: string): Promise<ProbeRow | null> {
  const rows = await selectRows<ProbeRow>(
    "probe_runs",
    `select=probe,run_at,headline,summary&probe=eq.${probe}&order=run_at.desc&limit=1`,
  );
  return rows?.[0] ?? null;
}

async function history(probe: string, limit = 30): Promise<ProbeRow[]> {
  const rows = await selectRows<ProbeRow>(
    "probe_runs",
    `select=probe,run_at,headline,summary&probe=eq.${probe}&order=run_at.desc&limit=${limit}`,
  );
  return rows ?? [];
}

export default async function LabPage() {
  const data = await Promise.all(
    PROBES.map(async (p) => ({
      ...p,
      newest: await latest(p.id),
      rows: await history(p.id, 12),
    })),
  );

  return (
    <main className="lp-shell" style={{ maxWidth: 980, margin: "0 auto", padding: "96px 24px 64px" }}>
      <p style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.6 }}>
        Lab · unlisted
      </p>
      <h1 style={{ fontSize: 34, margin: "8px 0 12px" }}>Probe results</h1>
      <p style={{ opacity: 0.75, maxWidth: 680, lineHeight: 1.6 }}>
        Two questions asked every day, and the answers kept as they were given. A single day is trivia; the
        movement is the point. Raw rows live in <code>probe_runs</code>.
      </p>

      {!isSupabaseConfigured() ? (
        <p style={{ marginTop: 24, padding: 14, border: "1px solid #b45309", borderRadius: 8 }}>
          Supabase is not configured in this environment, so nothing can be read. This is a configuration
          fault, not an empty trend.
        </p>
      ) : null}

      {data.map((p) => (
        <section key={p.id} style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 22, marginBottom: 4 }}>{p.label}</h2>
          <p style={{ opacity: 0.7, marginTop: 0, maxWidth: 680 }}>{p.question}</p>

          {p.newest === null ? (
            <p style={{ marginTop: 12, padding: 14, border: "1px dashed #6b7280", borderRadius: 8 }}>
              <strong>Never run.</strong> No row exists for this probe, so there is no number to show — a zero
              here would be an invented measurement.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 12, fontSize: 18 }}>
                <strong>{p.newest.headline ?? "—"}</strong>{" "}
                <span style={{ opacity: 0.6, fontSize: 14 }}>
                  latest run {new Date(p.newest.run_at).toISOString().slice(0, 10)} ({ago(p.newest.run_at)})
                </span>
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.6 }}>
                    <th style={{ padding: "6px 8px" }}>run</th>
                    <th style={{ padding: "6px 8px" }}>result</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.run_at} style={{ borderTop: "1px solid rgba(128,128,128,0.25)" }}>
                      <td style={{ padding: "6px 8px" }}>{new Date(r.run_at).toISOString().slice(0, 10)}</td>
                      <td style={{ padding: "6px 8px" }}>{r.headline ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      ))}

      <p style={{ marginTop: 48, fontSize: 13, opacity: 0.55 }}>
        Unlisted by design. Numbers are the probes&apos; own output; where a probe has not run, the page says so.
      </p>
    </main>
  );
}
