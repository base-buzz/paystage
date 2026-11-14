import type { Metadata } from "next";
import services from "../../../../../registry/services.json";

// Read the count from the registry itself so the copy cannot drift from the data.
const registryCount = (services as unknown[]).length;
import "../landing.css";

export const metadata: Metadata = {
  title: "Contribute",
  description:
    "Three ways to help PayStage and get something back: list your x402 service, report a malicious payee with a citation, or improve the tools.",
};

const WAYS = [
  {
    tag: "list your service",
    title: "Get your x402 API into the registry",
    body: "If you sell anything over x402 on Base, add it. Each entry records what you sell, what it costs and which network you settle on — and gets checked against your live endpoint before it is merged.",
    gives: "You get discovery from agents and developers looking for paid APIs. We get a curated picture of who is actually selling, which is the data the registry needs to be worth anything.",
    cta: "Open a pull request",
    href: "https://github.com/base-buzz/paystage/blob/main/registry/README.md",
  },
  {
    tag: "report a payee",
    title: "Report a drainer address, with a citation",
    body: "The deny list only accepts addresses that carry a public source — an incident report, an advisory, an explorer label. Send the address and the link; if the citation holds, it ships in the next release.",
    gives: "You get the address blocked for every user of the gate, including your own agent if it uses PayStage. We get a list that stays small, cited and useful instead of a blocklist nobody trusts.",
    cta: "Read the curation policy",
    href: "https://github.com/base-buzz/paystage/blob/main/packages/preflight/KNOWN_DRAINERS.md",
  },
  {
    tag: "improve the tools",
    title: "Fix something or add a test",
    body: "Every package has tests and a changelog. Issues are open, the release cadence is weekly, and a patch that makes a verdict clearer is more valuable than one that adds a tool.",
    gives: "You get a project that answers within a day. We get the thing that matters more than code: someone else reading the decisions.",
    cta: "See open issues",
    href: "https://github.com/base-buzz/paystage/issues",
  },
];

export default function ContributePage() {
  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <a className="lp-brand" href="/" aria-label="PayStage home">
            <span>PayStage</span>
          </a>
          <nav className="lp-nav" aria-label="Primary">
            <a href="/">Home</a>
            <a href="/console">Console</a>
            <a className="lp-nav-cta" href="https://github.com/base-buzz/paystage" rel="noopener">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero" style={{ paddingBottom: 40 }}>
          <div className="lp-wrap">
            <p className="lp-eyebrow">Contribute</p>
            <h1 className="lp-h1" style={{ maxWidth: "22ch" }}>
              Help the gate get <em>harder to fool</em>.
            </h1>
            <p className="lp-lede">
              Three ways in, all of them useful to you first. Nothing here asks for
              unpaid marketing — every contribution either gets your work discovered or
              blocks someone who is stealing. The registry currently lists{" "}
              {registryCount} verified endpoints, every one probed before it went in.
            </p>
          </div>
        </section>

        <section className="lp-section" style={{ borderTop: "1px solid var(--lp-line-soft)" }}>
          <div className="lp-wrap lp-cards">
            {WAYS.map((way) => (
              <article className="lp-card" key={way.title} style={{ cursor: "default" }}>
                <span className="lp-card-tag">{way.tag}</span>
                <h3>{way.title}</h3>
                <p style={{ marginBottom: 10 }}>{way.body}</p>
                <p style={{ marginBottom: 14, color: "var(--lp-faint)" }}>{way.gives}</p>
                <a className="lp-btn lp-btn-ghost" href={way.href} rel="noopener">
                  {way.cta}
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section lp-section-alt">
          <div className="lp-wrap lp-split">
            <div className="lp-body">
              <h2 className="lp-h2" style={{ marginBottom: 16 }}>
                What we will not do
              </h2>
              <p>
                No paid placement in the registry. No badge you can buy. No download
                games, no sockpuppet stars, no fake users. If a listing cannot be
                verified against a live endpoint it does not go in — that restriction is
                the only reason a listing means anything.
              </p>
            </div>
            <div className="lp-body">
              <h2 className="lp-h2" style={{ marginBottom: 16 }}>
                What you get for it
              </h2>
              <p>
                A merged pull request, a changelog line with your handle, and a place in
                a list agents and developers actually read. Small, real, and permanent —
                which is more than most contributor funnels offer.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <p className="lp-fine">
            PayStage is MIT licensed. Contributions are reviewed for accuracy, not
            volume. Not financial advice.{" "}
            <a href="/privacy" style={{ textDecoration: "underline" }}>
              Privacy
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
