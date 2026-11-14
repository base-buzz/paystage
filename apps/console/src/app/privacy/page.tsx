import type { Metadata } from "next";
import "../landing.css";
import { SOCIALS } from "@/lib/agent-manifest";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What PayStage records when an agent calls the hosted API, what it does not record, what the public live feed shows, and how to ask for a row to be deleted.",
  alternates: { canonical: "https://paystage.xyz/privacy" },
};

const CONTACT = "basebuzz69@gmail.com";

export default function PrivacyPage() {
  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <a className="lp-brand" href="/" aria-label="PayStage home">
            <svg className="lp-brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0a0b0e" />
              <rect x="1" y="1" width="30" height="30" rx="6" fill="none" stroke="#232733" strokeWidth="1" />
              <path
                d="M11 8h6.2c3.1 0 5.3 2 5.3 5s-2.2 5-5.3 5H14v6h-3V8zm3 2.6v4.8h3c1.5 0 2.4-.9 2.4-2.4s-.9-2.4-2.4-2.4h-3z"
                fill="#6ee7b7"
              />
              <circle cx="23.5" cy="23.5" r="2.5" fill="#34d399" />
            </svg>
            <span>PayStage</span>
          </a>
          <nav className="lp-nav" aria-label="Primary">
            <a href="/">Home</a>
            <a href="/console">Console</a>
            <span aria-current="page">Privacy</span>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap">
            <p className="lp-eyebrow">Privacy</p>
            <h1 className="lp-h1" style={{ maxWidth: "24ch" }}>
              What PayStage stores, and what it does not.
            </h1>
            <p className="lp-lede">
              PayStage is a read-only payment-safety service. This page describes the data the
              hosted API records, the data the public site shows, and how to ask us to delete a
              row. It describes the code in this repository, not an aspirational policy.
            </p>
            <p className="lp-hero-note">Last updated 14 November 2026.</p>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-body">
              <h2 className="lp-h2" style={{ marginBottom: 14 }}>
                What we record
              </h2>
              <p>
                When an agent or client asks the hosted API to evaluate a payment, we record a
                telemetry event for the call. The event contains the tool name, the decision, the
                reason codes behind it, the network, the request latency, a timestamp and a source
                label: <code>real</code>, <code>free-tier</code>, <code>synthetic</code> or{" "}
                <code>test</code>. An evaluation event may also carry a request id, the facilitator
                status and an error class so a failed call can be diagnosed without guessing.
              </p>
              <p>
                When a payment settles, a separate settlement event records the{" "}
                <strong>payer address</strong> and the <strong>transaction hash</strong>. Both are
                already public on the blockchain.
              </p>

              <h2 className="lp-h2" style={{ margin: "32px 0 14px" }}>
                What we do not record
              </h2>
              <p>
                We do not create accounts, and we do not ask for a name, email address or any
                other profile. The events table has no IP address column, no cookie identifier and
                no device fingerprint.
              </p>
              <p>
                The free tier enforces a soft limit of 1,000 free calls per IP per day. The counter
                lives <em>inside a single worker isolate&rsquo;s memory</em>, so the real ceiling is
                that limit times the number of warm isolates. It is never written to the database
                and disappears with the isolate. We set no tracking cookies.
              </p>

              <h2 className="lp-h2" style={{ margin: "32px 0 14px" }}>
                What is public
              </h2>
              <p>
                The live feed on the site reads a separate table called{" "}
                <code>events_feed</code>. That table stores an internal row id plus the tool,
                decision, source, network and time of a call. The site displays the last five; it
                does not show payer addresses, transaction hashes, request ids or error classes.
              </p>
              <p>
                Payer addresses are public on-chain by nature. PayStage does not display payer
                addresses on the site. The live feed has no payer column, so the feed itself cannot
                tell you who paid.
              </p>

              <h2 className="lp-h2" style={{ margin: "32px 0 14px" }}>
                Deletion
              </h2>
              <p>
                To ask for a telemetry row to be removed, email{" "}
                <a href={`mailto:${CONTACT}`} style={{ textDecoration: "underline" }}>
                  {CONTACT}
                </a>{" "}
                with the transaction hash or request id, or the approximate time and tool name.
                We will delete the matching row from the events record and, where it exists, the
                mirrored row in the public feed. We may ask for enough detail to find the row, and
                nothing more than that.
              </p>
              <p>
                We cannot delete on-chain data. The payer address and transaction hash already
                exist on the public blockchain; removing our copy does not remove them from the
                chain or from block explorers.
              </p>

              <h2 className="lp-h2" style={{ margin: "32px 0 14px" }}>
                Cookies and analytics
              </h2>
              <p>
                The marketing pages are statically prerendered by Next.js, and this privacy page
                contains no analytics code. The site loads no third-party
                analytics, advertising pixels or tracking scripts, and it does not use cookies to
                follow you. The console reads the public live feed directly with a Supabase
                publishable key; that key identifies the project, not the reader.
              </p>

              <h2 className="lp-h2" style={{ margin: "32px 0 14px" }}>
                Changes
              </h2>
              <p>
                If this policy changes, the date at the top of the page changes with it. The page
                lives in the repository at{" "}
                <code>apps/console/src/app/privacy/page.tsx</code>, and the telemetry code it
                describes is public at{" "}
                <a
                  href="https://github.com/base-buzz/paystage/blob/main/apps/hosted/src/telemetry.ts"
                  rel="noopener"
                  style={{ textDecoration: "underline" }}
                >
                  apps/hosted/src/telemetry.ts
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <div>
              <div className="lp-brand" style={{ marginBottom: 8 }}>
                <span>PayStage</span>
              </div>
              <div className="lp-hero-note" style={{ margin: 0 }}>
                A read-only seatbelt for agents that spend.
              </div>
            </div>
            <nav className="lp-footer-nav" aria-label="Footer">
              {SOCIALS.map((social) => (
                <a key={social.label} href={social.url} rel="me noopener">
                  {social.label}
                </a>
              ))}
              <a href="/llms.txt">llms.txt</a>
              <a href="/console">Console</a>
              <a href="/contribute">Contribute</a>
              <a href={`mailto:${CONTACT}`}>Contact</a>
            </nav>
          </div>
          <p className="lp-fine">
            PayStage evaluates payment requests against a policy you write and returns a
            decision; it holds no keys, signs nothing, and never moves funds. Not financial
            advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
