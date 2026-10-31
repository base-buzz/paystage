const PACKAGES = [
  { name: "@paystage/mcp", version: "0.2.1" },
  { name: "@paystage/preflight", version: "0.1.0" },
  { name: "@paystage/velocity", version: "0.1.2" },
  { name: "@paystage/auth-watch", version: "0.1.0" },
  { name: "@paystage/trade-preflight", version: "0.1.2" },
  { name: "@paystage/policy", version: "0.1.0" },
] as const;

interface PkgStat {
  name: string;
  version: string;
  downloads: number | null;
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

async function fetchStars(): Promise<number | null> {
  try {
    const res = await fetch("https://api.github.com/repos/base-buzz/paystage", {
      next: { revalidate: 3600 },
      headers: { Accept: "application/vnd.github+json" },
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

function fmt(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export async function ProgressStrip() {
  const [stars, ...dl] = await Promise.all([
    fetchStars(),
    ...PACKAGES.map((p) => fetchDownloads(p.name)),
  ]);
  const pkgs: PkgStat[] = PACKAGES.map((p, i) => ({
    ...p,
    downloads: dl[i] ?? null,
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
            <span className="muted">v{p.version}</span>
            <span className="progress-dl">{fmt(p.downloads)} /mo</span>
          </div>
        ))}
      </div>
      <div className="progress-footer">
        <span className="muted">GitHub ★ {fmt(stars)}</span>
        <a
          href="https://registry.modelcontextprotocol.io/v0/servers?search=xyz.paystage"
          target="_blank"
          rel="noopener noreferrer"
          className="link"
        >
          MCP registry · xyz.paystage/mcp
        </a>
      </div>
    </section>
  );
}
