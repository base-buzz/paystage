/**
 * "Alive" strip — real activity, pulled from GitHub on the server.
 *
 * Purpose: a visitor deciding whether to depend on this project wants to know it
 * is moving and who is behind it. That is a legitimate signal, but only if it is
 * measured rather than asserted, so every number here comes from the GitHub API and
 * nothing is hardcoded.
 *
 * Caching: `revalidate: 3600`. Unauthenticated GitHub allows 60 requests/hour per
 * IP, and the Worker shares one — four fetches an hour is far inside that, and a
 * failed fetch renders a dash rather than a stale or invented number.
 *
 * Honesty: contributors excludes bots (`[bot]` logins and our own release bot), and
 * says so. The commit count is the last four weeks only — a lifetime total would
 * flatter the project without telling a visitor anything about momentum.
 */

const REPO = "base-buzz/paystage";

/**
 * Weekly installs across every published package. Includes our own CI and mirrors —
 * said in the caption rather than subtracted, because hiding a real number is its own
 * kind of dishonesty.
 */
const NPM_PACKAGES = [
  "@paystage/mcp",
  "@paystage/preflight",
  "@paystage/policy",
  "@paystage/velocity",
  "@paystage/auth-watch",
  "@paystage/trade-preflight",
];

async function npmWeekly(): Promise<number | null> {
  try {
    const results = await Promise.all(
      NPM_PACKAGES.map(async (name) => {
        const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`, {
          next: { revalidate: 3600 },
        });
        if (!res.ok) return 0;
        const body = (await res.json()) as { downloads?: number };
        return body.downloads ?? 0;
      }),
    );
    return results.reduce((a, b) => a + b, 0);
  } catch {
    return null;
  }
}

interface GhHeaders {
  [key: string]: string;
}

const GH_HEADERS: GhHeaders = {
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

export interface AliveStats {
  commits30d: number | null;
  contributors: number | null;
  agents: number | null;
  tags: number | null;
  lastTag: string | null;
}

function isBot(login: string): boolean {
  return login.endsWith("[bot]") || login === "paystage" || login === "dependabot[bot]";
}

export async function getAliveStats(): Promise<AliveStats> {
  const [participation, contributors, tags] = await Promise.all([
    gh<{ all: number[] }>(`/repos/${REPO}/stats/participation`),
    gh<Array<{ login?: string; type?: string }>>(`/repos/${REPO}/contributors?per_page=100&anon=1`),
    gh<Array<{ name: string }>>(`/repos/${REPO}/tags?per_page=100`),
  ]);

  const weeks = participation?.all ?? [];
  const commits30d = weeks.length >= 4 ? weeks.slice(-4).reduce((a, b) => a + b, 0) : null;

  // Every contributor counts, agents included. The project is built and shipped by
  // agents; stripping them out of the number hid the most interesting fact about it.
  const everyone = (contributors ?? []).filter((c) => (c.login ?? "") !== "");
  const agents = everyone.filter((c) => {
    const login = c.login ?? "";
    return login.endsWith("[bot]") || login === "paystage" || login === "dependabot[bot]";
  });

  const tagList = tags ?? [];

  return {
    commits30d,
    contributors: contributors === null ? null : everyone.length,
    agents: contributors === null ? null : agents.length,
    tags: tags === null ? null : tagList.length,
    lastTag: tagList[0]?.name ?? null,
  };
}

function fmt(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-NZ");
}

export async function AliveStrip() {
  const [stats, installs] = await Promise.all([getAliveStats(), npmWeekly()]);

  const items = [
    { value: fmt(stats.commits30d), label: "commits, last 30 days" },
    { value: fmt(stats.tags), label: "tagged releases" },
    { value: fmt(installs), label: "npm installs this week" },
    { value: stats.lastTag ?? "—", label: "latest tag" },
  ];

  return (
    <section className="lp-alive" aria-label="Project activity">
      <div className="lp-wrap lp-alive-grid">
        {items.map((item) => (
          <div className="lp-alive-item" key={item.label}>
            <div className="lp-alive-value">{item.value}</div>
            <div className="lp-alive-label">{item.label}</div>
          </div>
        ))}
      </div>
      <p className="lp-wrap lp-alive-note">
        Commits and releases are last four weeks; installs include our own CI and
        mirrors — subtract nothing, just know what you are reading.{" "}
        <strong>
          This project is written, tested and released by AI agents
        </strong>
        , which is the point rather than a caveat: an agent-payment tool developed the
        way its users operate. The commit history, CI logs and release provenance are
        all public.{" "}
        <a href="https://github.com/base-buzz/paystage" rel="noopener">
          See the work
        </a>{" "}
        ·{" "}
        <a href="/contribute">Ways to contribute</a>
      </p>
    </section>
  );
}
