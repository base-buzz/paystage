/**
 * Cadence data — release rhythm and check history, from the GitHub API.
 *
 * Shared by the landing-page panel and the machine-readable endpoint at
 * `/v1/public/cadence.json`, so a human and an agent read exactly the same numbers.
 * Cached hourly per fetch; unauthenticated GitHub allows 60 requests/hour per IP and
 * the Worker shares one, so this stays at three calls.
 */

export const REPO = "base-buzz/paystage";
export const WEEKS = 10;
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
  /**
   * Whether the check history could actually be read.
   *
   * Distinguishing "the API said no" from "zero runs" matters: rendering 0/0 as
   * "nothing passing" is a false alarm, and GitHub's unauthenticated limit is shared
   * with every other Worker on the same egress IP, so a failed read is routine rather
   * than exceptional.
   */
  checksAvailable: boolean;
  releasesAvailable: boolean;
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
    checksAvailable: runs !== null,
    releasesAvailable: commits !== null,
  };
}
