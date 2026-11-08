import bakedCommits from "@/lib/recent-commits.json";
/**
 * Published versions come from the registry, not from this file.
 *
 * They used to be hardcoded here and went stale the moment a release shipped:
 * the console advertised 0.2.1 while npm had 0.3.0, for a week. A version the
 * console cannot verify is a version it should not print.
 */
const PACKAGES = [
  { name: "@paystage/mcp" },
  { name: "@paystage/preflight" },
  { name: "@paystage/velocity" },
  { name: "@paystage/auth-watch" },
  { name: "@paystage/trade-preflight" },
  { name: "@paystage/policy" },
] as const;

const REPO = "base-buzz/paystage";

interface PkgStat {
  name: string;
  version: string | null;
  downloads: number | null;
}

interface CommitRow {
  sha: string;
  message: string;
  date: string | null;
}

async function fetchDownloads(name: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { downloads?: number };
    return typeof data.downloads === "number" ? data.downloads : null;
  } catch {
    return null;
  }
}

async function fetchVersion(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

async function fetchStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      next: { revalidate: 3600 },
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "PayStageConsole/0.1",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
  }
}

async function fetchCommits(): Promise<CommitRow[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=5`,
      {
        next: { revalidate: 3600 },
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PayStageConsole/0.1",
        },
      },
    );
    if (!res.ok) return bakedCommits as CommitRow[];
    const data = (await res.json()) as Array<{
      sha: string;
      commit?: { message?: string; author?: { date?: string } };
    }>;
    return data.map((c) => ({
      sha: c.sha,
      message: (c.commit?.message ?? "").split("\n")[0] ?? "",
      date: c.commit?.author?.date ?? null,
    }));
  } catch {
    return bakedCommits as CommitRow[];
  }
}

async function fetchLatestRelease(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        next: { revalidate: 3600 },
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PayStageConsole/0.1",
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; name?: string };
    return data.tag_name ?? data.name ?? null;
  } catch {
    return null;
  }
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

export async function ProgressStrip() {
  const [stars, commits, release, ...rest] = await Promise.all([
    fetchStars(),
    fetchCommits(),
    fetchLatestRelease(),
    ...PACKAGES.flatMap((p) => [fetchDownloads(p.name), fetchVersion(p.name)]),
  ]);
  const pkgs: PkgStat[] = PACKAGES.map((p, i) => ({
    ...p,
    downloads: (rest[i * 2] as number | null) ?? null,
    version: (rest[i * 2 + 1] as string | null) ?? null,
  }));

  return (
    <section
      aria-labelledby="progress-heading"
      className="panel"
      style={{ padding: 16 }}
    >
      <h2 id="progress-heading" className="panel-title">
        Progress
      </h2>
      <div className="progress-grid">
        {pkgs.map((p) => (
          <div key={p.name} className="progress-item">
            <code className="progress-name">{p.name}</code>
            <span className="muted">{p.version ? `v${p.version}` : "version unknown"}</span>
            <span className="progress-dl">{fmt(p.downloads)} /mo</span>
          </div>
        ))}
      </div>
      <div className="progress-footer">
        <span className="muted">GitHub ★ {fmt(stars)}</span>
        {release ? (
          <span className="muted">release {release}</span>
        ) : null}
        <a
          href={`https://registry.modelcontextprotocol.io/v0/servers?search=xyz.paystage`}
          target="_blank"
          rel="noopener noreferrer"
          className="link"
        >
          MCP registry · xyz.paystage/mcp
        </a>
      </div>
      {commits.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <h3 className="panel-title" style={{ marginBottom: 8 }}>
            Recent commits
          </h3>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 6,
              fontSize: 13,
            }}
          >
            {commits.map((c) => (
              <li
                key={c.sha}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "baseline",
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 6,
                }}
              >
                <a
                  className="link"
                  style={{ minHeight: "auto", fontFamily: "monospace", fontSize: 12 }}
                  href={`https://github.com/${REPO}/commit/${c.sha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {c.sha.slice(0, 7)}
                </a>
                <span style={{ overflowWrap: "anywhere" }}>{c.message}</span>
                <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                  {relativeDate(c.date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
