import { getCadence, REPO, WEEKS } from "@/lib/cadence";

/**
 * `/v1/public/cadence.json` — is this project alive, in a form an agent can read.
 *
 * Same numbers as the landing-page panel, from the same loader, so a human and an
 * agent never see different stories. The point is not marketing: an agent deciding
 * whether to depend on a service needs to know its release rhythm and whether its
 * automated checks are currently passing, and it should be able to read that without
 * parsing prose or scraping a page.
 *
 * `checked_at` is when this response was rendered; the underlying GitHub reads are
 * cached for an hour, so it is not a per-request guarantee.
 */
export const revalidate = 3600;

export async function GET() {
  const data = await getCadence();

  const passing = data.checks.filter((c) => c.ok).length;
  const body = {
    checked_at: new Date().toISOString(),
    repository: `https://github.com/${REPO}`,
    releases: {
      window_weeks: WEEKS,
      count: data.releasesAvailable ? data.releasesTotal : null,
      available: data.releasesAvailable,
      per_week: data.weeks,
      latest_version: data.version,
    },
    checks: {
      workflow: `https://github.com/${REPO}/actions/workflows/cadence.yml`,
      schedule: "daily 09:00 Pacific/Auckland",
      recent_runs: data.checks,
      available: data.checksAvailable,
      passing: data.checksAvailable ? passing : null,
      total: data.checksAvailable ? data.checks.length : null,
      all_passing: data.checksAvailable ? data.checks.length > 0 && passing === data.checks.length : null,
    },
    note:
      "Release counts come from commits whose message starts 'release:'; check results from the cadence workflow's run history. Cached hourly.",
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
      "access-control-allow-origin": "*",
    },
  });
}
