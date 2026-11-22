import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";

/**
 * Issue 1 — the census, published with its method.
 *
 * Every number here comes from `ops/docs/state/census/2026-11.json`, generated 2026-11-15 from the official MCP Registry.
 * The liveness sample (#118) is deliberately **not** quoted: its own decision was to hold the claim until the series is
 * two or three months old, and a half-published number is exactly what this post exists to avoid.
 */
/**
 * The supply side, from the weekly inventory (`ops/docs/state/supply/YYYY-MM-DD.json`).
 *
 * Two different questions live on this page and must not blur: the registry tells you what *exists*, the catalogues tell you what is *for sale*. A catalogue
 * entry is a seller's claim, not something we probed, and zero flagged out of 1,223 payees is the absence of a match against 23 cited addresses — not a
 * clean bill of health.
 */
const SUPPLY = [
  { value: "18,043", label: "resources advertised", note: "PayAI's public discovery endpoint" },
  { value: "24,799", label: "accepts recorded", note: "one resource can offer several assets or networks" },
  { value: "1,351", label: "distinct payees", note: "the rest Solana / Algorand / other alongside the EVM majority" },
  { value: "29", label: "CAIP-2 networks", note: "13,306 accepts on eip155:8453 (Base) alone" },
  { value: "0", label: "flagged by our lists", note: "against 24 cited addresses — see the caveat below" },
  { value: "7,314", label: "accepts on Solana", note: "outside what an EVM policy can express today" },
];

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

      <h2>What the catalogues list</h2>
      <p>
        The registry above counts what is <em>published</em>. This counts what is <em>for sale</em>: one walk of PayAI&apos;s
        public discovery endpoint, screened against the same OFAC and drainer lists the evaluator ships.
      </p>
      <div className="sx-stats">
        {SUPPLY.map((s) => (
          <div className="sx-stat" key={s.label}>
            <div className="sx-stat-value">{s.value}</div>
            <div className="sx-stat-label">{s.label}</div>
            <div className="sx-stat-note">{s.note}</div>
          </div>
        ))}
      </div>
      <p>
        <strong>Zero flagged is not a clean bill of health.</strong> It means no payee in this catalogue matches one of 24 curated, cited
        addresses — a 2% hit rate would be the surprising number. The finding worth carrying is the coverage one:{" "}
        <strong>6,742 accepts are on Solana</strong> and 1,704 use a bare <code>base</code> label instead of a CAIP-2 identifier, so a
        large share of this market sits outside what an EVM-and-CAIP-2 policy can express at all.
      </p>

      <h2>Method</h2>
      <p>
        Supply figures: one complete walk of PayAI&apos;s discovery endpoint on <strong>2026-11-22</strong>, refreshed weekly, screened against the same lists
        the evaluator ships. The inventory is a catalogue read, not a probe of each seller — a listing is a claim, and the payee registry only accepts hosts
        whose 402 challenge we have read ourselves.
      </p>
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
