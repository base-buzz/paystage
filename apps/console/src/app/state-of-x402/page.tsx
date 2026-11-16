import type { Metadata } from "next";
import Link from "next/link";

/**
 * Issue 1 — the census, published with its method.
 *
 * Every number here comes from `ops/docs/state/census/2026-11.json`, generated 2026-11-15 from the official MCP Registry.
 * The liveness sample (#118) is deliberately **not** quoted: its own decision was to hold the claim until the series is
 * two or three months old, and a half-published number is exactly what this post exists to avoid.
 */
export const metadata: Metadata = {
  title: "State of x402 — November 2026",
  description:
    "348 distinct x402 servers in the MCP Registry, 69% with a remote endpoint, and 8 already using safety vocabulary. Method and snapshot included.",
};

const STATS = [
  { value: "348", label: "distinct servers in the registry", note: "683 rows, 335 duplicates collapsed by name" },
  { value: "241", label: "with a remote endpoint", note: "69.3% — the rest are install-once packages" },
  { value: "8", label: "using safety vocabulary", note: "preflight, guard, policy, spend limit, allowlist" },
  { value: "133", label: "servers still on 1.0.0", note: "the most common version, then 0.1.0 at 63" },
];

export default function StateOfX402() {
  return (
    <main className="lp-wrap lp-prose">
      <p className="lp-eyebrow">STATE OF X402 · ISSUE 1 · NOVEMBER 2026</p>
      <h1>The x402 registry, counted</h1>
      <p className="lp-lead">
        Every month we count what is actually listed for x402 agents, and publish the count with its method. Not a
        roundup of announcements — a census, so next month&apos;s number means something.
      </p>

      <h2>What the registry holds today</h2>
      <div className="sx-stats">
        {STATS.map((s) => (
          <div className="sx-stat" key={s.label}>
            <div className="sx-stat-value">{s.value}</div>
            <div className="sx-stat-label">{s.label}</div>
            <div className="sx-stat-note">{s.note}</div>
          </div>
        ))}
      </div>

      <h2>Method</h2>
      <p>
        Source: the official MCP Registry, queried in full and deduplicated by server name — 683 rows collapse to 348
        distinct servers, because a publisher with twenty versions otherwise takes twenty slots. Snapshot taken{" "}
        <strong>2026-11-15</strong>.
      </p>
      <p>
        &ldquo;Safety vocabulary&rdquo; means the description contains one of: preflight, guard, policy, spend control,
        spend limit, allowlist, allow-list. That is a keyword count, not a quality judgement — it tells you the words are
        spreading, not whether the checks work.
      </p>

      <h2>What we are not claiming</h2>
      <p>
        We have measured how many of these endpoints actually respond, but we are <strong>not</strong> publishing that
        number yet: it needs two or three months of a stable series before it is worth quoting, and a single sample
        would be a claim wearing a statistic&apos;s clothes. When it is published, the sample size and date will appear
        beside it, as they do above.
      </p>

      <h2>Why count at all</h2>
      <p>
        The x402 ecosystem is discussed almost entirely in announcements. A count with a method is falsifiable: if
        someone says &ldquo;there are thousands of x402 servers&rdquo;, they can be checked against this. That is the
        same reason{" "}
        <a href="https://github.com/base-buzz/paystage/blob/main/LIMITS.md">LIMITS.md</a> exists for the product.
      </p>

      <p className="lp-prose-back">
        <Link href="/">← PayStage</Link> · <Link href="/glossary">glossary</Link> ·{" "}
        <a href="https://github.com/base-buzz/paystage">source</a>
      </p>
    </main>
  );
}
