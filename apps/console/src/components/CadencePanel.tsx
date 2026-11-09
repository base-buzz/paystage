/**
 * Cadence panel — release rhythm and check history, measured.
 *
 * The claim this supports is "this project is active". That claim is only worth
 * anything if a visitor can see the rhythm rather than take our word for it, so
 * every mark here comes from the GitHub API:
 *
 *   - releases: commits whose message starts `release:` in the last 70 days,
 *     bucketed by week. One API call.
 *   - checks: the last runs of the `cadence` workflow. One API call.
 *   - version: the published `@paystage/mcp` version from the npm registry.
 *
 * Cached hourly (`revalidate: 3600`). Unauthenticated GitHub allows 60 requests an
 * hour per IP and the Worker shares one; this panel costs three.
 *
 * A failed fetch renders nothing for that series — never a fabricated bar. An empty
 * week is a zero-height bar, which is honest: it means no release that week.
 */

const REPO = "base-buzz/paystage";
const WEEKS = 10;
const DAY_MS = 86_400_000;
const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "PayStageSite/1.0",
};

async function gh<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: GH_HEADERS,
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface ReleaseWeek {
  label: string;
  count: number;
}

interface CheckRun {
  ok: boolean;
  at: string;
}

export interface CadenceData {
  weeks: ReleaseWeek[];
  releasesTotal: number;
  version: string | null;
  checks: CheckRun[];
}

function weekLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getCadence(): Promise<CadenceData> {
  const since = new Date(Date.now() - (WEEKS * 7 + 7) * DAY_MS).toISOString();

  const [commits, runs, npm] = await Promise.all([
    gh<Array<{ commit: { message: string; committer: { date: string } } }>>(
      `/repos/${REPO}/commits?per_page=100&since=${since}`,
    ),
    gh<{ workflow_runs: Array<{ conclusion: string | null; created_at: string }> }>(
      `/repos/${REPO}/actions/workflows/cadence.yml/runs?per_page=12`,
    ),
    fetch(`https://registry.npmjs.org/@paystage%2Fmcp/latest`, {
      next: { revalidate: 3600 },
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ version?: string }>) : null))
      .catch(() => null),
  ]);

  const now = Date.now();
  const buckets: ReleaseWeek[] = Array.from({ length: WEEKS }, (_, i) => {
    const start = new Date(now - (WEEKS - i) * 7 * DAY_MS);
    return { label: weekLabel(start), count: 0 };
  });

  let releasesTotal = 0;
  for (const entry of commits ?? []) {
    const message = entry.commit?.message ?? "";
    if (!/^release[:!]/i.test(message)) continue;
    const at = Date.parse(entry.commit.committer?.date ?? "");
    if (Number.isNaN(at)) continue;
    const weeksAgo = Math.floor((now - at) / (7 * DAY_MS));
    const index = WEEKS - 1 - weeksAgo;
    if (index >= 0 && index < WEEKS) {
      buckets[index].count += 1;
      releasesTotal += 1;
    }
  }

  const checks: CheckRun[] = (runs?.workflow_runs ?? []).map((run) => ({
    ok: run.conclusion === "success",
    at: run.created_at.slice(0, 10),
  }));

  return {
    weeks: buckets,
    releasesTotal,
    version: npm?.version ?? null,
    checks,
  };
}

export async function CadencePanel() {
  const data = await getCadence();
  const max = Math.max(1, ...data.weeks.map((w) => w.count));

  return (
    <section className="lp-section lp-section-alt" aria-label="Cadence">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <h2 className="lp-h2">Cadence</h2>
          <p className="lp-h2-note">
            Releases and automated checks, read from the repository and CI. Not a
            badge — the actual history.
          </p>
        </div>

        <div className="lp-cadence">
          <div className="lp-cadence-block">
            <div className="lp-cadence-head">
              <span>Releases · last {WEEKS} weeks</span>
              <span className="lp-cadence-strong">
                {data.releasesTotal === 0 ? "—" : `${data.releasesTotal} shipped`}
              </span>
            </div>
            <div className="lp-bars" role="img" aria-label={`${data.releasesTotal} releases in the last ${WEEKS} weeks`}>
              {data.weeks.map((week) => (
                <div className="lp-bar-col" key={week.label}>
                  <div
                    className="lp-bar"
                    style={{ height: `${Math.max(3, Math.round((week.count / max) * 46))}px` }}
                    data-count={week.count}
                    title={`week of ${week.label}: ${week.count} release${week.count === 1 ? "" : "s"}`}
                  />
                </div>
              ))}
            </div>
            <div className="lp-cadence-foot">
              {data.weeks[0]?.label} → today · {data.version ? `mcp v${data.version}` : "version unknown"}
            </div>
          </div>

          <div className="lp-cadence-block">
            <div className="lp-cadence-head">
              <span>Automated checks · recent runs</span>
              <span className="lp-cadence-strong">
                {data.checks.length === 0
                  ? "—"
                  : `${data.checks.filter((c) => c.ok).length}/${data.checks.length} passing`}
              </span>
            </div>
            <div className="lp-runs">
              {data.checks.length === 0 && <span className="lp-cadence-foot">No runs recorded yet.</span>}
              {data.checks.map((check) => (
                <span
                  key={check.at}
                  className={check.ok ? "lp-run lp-run-ok" : "lp-run lp-run-fail"}
                  title={`${check.at}: ${check.ok ? "passed" : "failed"}`}
                />
              ))}
            </div>
            <div className="lp-cadence-foot">
              Conformance and dependency audit, daily.{" "}
              <a href={`https://github.com/${REPO}/actions/workflows/cadence.yml`} rel="noopener">
                See the runs
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
