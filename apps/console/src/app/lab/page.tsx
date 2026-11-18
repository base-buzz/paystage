import type { Metadata } from "next";
import "../landing.css";
import { selectRowsStrict } from "@/lib/supabase";

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
  {
    id: "outreach",
    label: "Outreach",
    // Aggregate only. The page is public: naming the repositories whose payment paths are unguarded would turn a
    // measurement into a shaming list, and the point is the shape of the ecosystem, not any one project.
    question: "How much of the x402 ecosystem pays without a gate — and is that measurement trustworthy?",
  },
];

/**
 * A number is only rendered when its control passed.
 *
 * The outreach measurement published 19.5% before four controls caught what was wrong with it. A page that renders a
 * percentage whose control failed is a worse version of that mistake: it is the same error, made permanent and public.
 * So `controls_ok: false` renders as **controls failed** and no figure, and an absent flag — a row written before this
 * rule existed — is treated as failed, because unknown is not a licence to print a number.
 */
function headlineFor(probe: string, row: ProbeRow): string {
  const summary = (row.summary ?? {}) as Record<string, unknown>;
  if (probe === "outreach" && summary.controls_ok !== true) return "controls failed — no figure";
  return row.headline ?? "—";
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * Read failures are returned, not swallowed.
 *
 * The first version used `selectRows`, which collapses every failure to `null` — so a missing service key or a policy
 * rejection rendered as "Never run", which is a truthful-looking lie about a probe that may have run for a month. The
 * page now distinguishes "no rows" from "could not read", and says which.
 */
async function read(probe: string, limit: number) {
  const result = await selectRowsStrict<ProbeRow>(
    "probe_runs",
    `select=probe,run_at,headline,summary&probe=eq.${probe}&order=run_at.desc&limit=${limit}`,
  );
  return result;
}

const REASON_TEXT: Record<string, string> = {
  not_configured: "Supabase is not configured in this environment. A configuration fault, not an empty trend.",
  no_service_key:
    "SUPABASE_SERVICE_ROLE_KEY is not set. `probe_runs` has RLS on with no policy, so reading with the anon key returns zero rows — which would render as \"never run\" and be wrong.",
  forbidden: "The service key was refused for this table (401/403). The rows exist; this environment cannot read them.",
  unreachable: "The database could not be reached. No conclusion about the probes can be drawn from this page right now.",
};

export default async function LabPage() {
  const data = await Promise.all(
    PROBES.map(async (p) => {
      const result = await read(p.id, 12);
      return {
        ...p,
        failure: result.ok ? null : result.reason,
        status: result.ok ? null : result.status ?? null,
        rows: result.ok ? result.rows : [],
      };
    }),
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


      {data.map((p) => (
        <section key={p.id} style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 22, marginBottom: 4 }}>{p.label}</h2>
          <p style={{ opacity: 0.7, marginTop: 0, maxWidth: 680 }}>{p.question}</p>

          {p.failure !== null ? (
            <p style={{ marginTop: 12, padding: 14, border: "1px solid var(--lp-amber, #b45309)", borderRadius: 8 }}>
              <strong>Could not read.</strong> {REASON_TEXT[p.failure]}
              {p.status !== null ? ` (HTTP ${p.status})` : ""}
            </p>
          ) : p.rows.length === 0 ? (
            <p style={{ marginTop: 12, padding: 14, border: "1px dashed var(--lp-line, #6b7280)", borderRadius: 8 }}>
              <strong>Never run.</strong> No row exists for this probe, so there is no number to show — a zero
              here would be an invented measurement.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 12, fontSize: 18 }}>
                <strong>{p.rows[0] ? headlineFor(p.id, p.rows[0]) : "—"}</strong>{" "}
                <span style={{ opacity: 0.6, fontSize: 14 }}>
                  latest run {new Date(p.rows[0]?.run_at ?? Date.now()).toISOString().slice(0, 10)} ({ago(p.rows[0]?.run_at ?? "")})
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
                      <td style={{ padding: "6px 8px" }}>{headlineFor(p.id, r)}</td>
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
