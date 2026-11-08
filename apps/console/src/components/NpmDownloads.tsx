"use client";

import { useEffect, useState } from "react";

/**
 * npm downloads, last 30 days, per published package.
 *
 * Deliberately on the console rather than the pitch: downloads cannot distinguish a
 * developer trying the tool from CI, bots, or our own installs, so they are a
 * fact about the registry rather than evidence of users. Rule 2 says never inflate
 * npm counts; the honest version of that is to publish the raw number *with* the
 * caveat, on the page whose job is measurement.
 *
 * The call goes straight to api.npmjs.org, which sends
 * `access-control-allow-origin: *` — no proxy, and the number a visitor sees is the
 * registry's, not ours.
 */

const PACKAGES = [
  "@paystage/mcp",
  "@paystage/preflight",
  "@paystage/policy",
  "@paystage/auth-watch",
  "@paystage/velocity",
  "@paystage/trade-preflight",
] as const;

type Row = { name: string; downloads: number | null };

export function NpmDownloads() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const results = await Promise.all(
          PACKAGES.map(async (name) => {
            const res = await fetch(
              `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`,
              { signal: AbortSignal.timeout(8000) },
            );
            if (!res.ok) return { name, downloads: null };
            const body = (await res.json()) as { downloads?: number };
            return { name, downloads: typeof body.downloads === "number" ? body.downloads : null };
          }),
        );
        if (live) setRows(results);
      } catch {
        if (live) setFailed(true);
      }
    };
    load();
    return () => {
      live = false;
    };
  }, []);

  const total = rows?.reduce((sum, r) => sum + (r.downloads ?? 0), 0) ?? 0;

  return (
    <section className="panel" aria-label="npm downloads">
      <h2 style={{ marginTop: 0 }}>npm downloads · last 30 days</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        From the npm registry, not from us. Includes CI, bots and our own installs —
        this is a fact about the registry, not a user count.
      </p>
      {failed && <p className="muted">Registry unavailable — nothing shown rather than a guess.</p>}
      {!failed && rows === null && <p className="muted">Loading…</p>}
      {rows !== null && (
        <>
          <table className="panel" style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td style={{ padding: "6px 10px" }}>
                    <code>{row.name}</code>
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {row.downloads === null ? "—" : row.downloads.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ padding: "6px 10px", fontWeight: 600 }}>total</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {total.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </section>
  );
}
