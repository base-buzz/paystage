import type { Metadata } from "next";
import "./landing.css";
import { AliveStrip } from "@/components/AliveStrip";
import { CadencePanel } from "@/components/CadencePanel";

export const metadata: Metadata = {
  title: "PayStage — Safety tools for AI agent payments",
  description:
    "PayStage sits outside an agent's wallet: five small MCP tools that evaluate a proposed payment against your local policy and return pay, review or do-not-pay — with the rule that fired. No keys, no signing.",
  alternates: { canonical: "https://paystage.xyz/" },
  openGraph: {
    title: "PayStage — Safety tools for AI agent payments",
    description:
      "A read-only seatbelt outside the wallet. Local policy in, pay / review / do-not-pay out, before anything is signed.",
    url: "https://paystage.xyz/",
    siteName: "PayStage",
    type: "website",
  },
};

const TOOLS = [
  ["evaluate_mcp_payment", "x402 payment request vs. local policy → pay · review · do_not_pay"],
  ["list_outstanding_auths", "ERC-20, Permit2 and EIP-3009 authorisations still outstanding"],
  ["evaluate_outstanding_auths", "flags authorisations needing attention before the next payment"],
  ["evaluate_hip3_trade", "HIP-3 / trade.xyz order vs. your TradePolicy → allow · review · do_not_trade"],
  ["evaluate_velocity", "rolling rate and spend checks: bursts, spikes, runaway cadence"],
] as const;

export default function LandingPage() {
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
            <a href="#how">How it works</a>
            <a href="#why">Why now</a>
            <a href="#agents">For agents</a>
            <a href="#evidence">Safety</a>
            <a href="/console">Console</a>
            <a className="lp-nav-cta" href="https://www.npmjs.com/package/@paystage/mcp" rel="noopener">
              Install
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <p className="lp-eyebrow">x402 · MCP · USDC on Base</p>
              <h1 className="lp-h1">
                Stop the payment <em>before</em> it&apos;s signed.
              </h1>
              <p className="lp-lede">
                AI agents now pay for things on their own — x402 APIs, MCP servers, perp
                venues. Wallets sign whatever the agent asks and nothing checks whether
                it should. PayStage is a read-only seatbelt outside the wallet:{" "}
                <strong>five small MCP tools</strong> that evaluate a proposed payment
                against your local policy and return <strong>pay</strong>,{" "}
                <strong>review</strong> or <strong>do-not-pay</strong> — with the rule
                that fired.
              </p>
              <div className="lp-actions">
                <a
                  className="lp-btn lp-btn-primary"
                  href="https://github.com/base-buzz/paystage#quick-start"
                  rel="noopener"
                >
                  Get started
                </a>
                <code className="lp-btn lp-btn-ghost">npx -y @paystage/mcp</code>
              </div>
              <p className="lp-hero-note">
                No key, no config, no account. MIT licensed. Holds no keys and never signs.
              </p>
            </div>

            <aside className="lp-gate" aria-label="Example evaluation">
              <div className="lp-gate-head">
                <span>one evaluation</span>
                <span>~40 ms</span>
              </div>
              <div className="lp-gate-row">
                <span aria-hidden="true">→</span>
                <code>payTo 0x6160…3757e · 12.50 USDC</code>
              </div>
              <div className="lp-gate-arrow" aria-hidden="true">
                ↓
              </div>
              <div className="lp-gate-row">
                <span aria-hidden="true">◆</span>
                <code>policy.json · allowed_pay_to, max_amount</code>
              </div>
              <div className="lp-gate-arrow" aria-hidden="true">
                ↓
              </div>
              <div className="lp-gate-verdict">
                <div className="lp-gate-verdict-label">verdict</div>
                <div className="lp-gate-verdict-value">do_not_pay</div>
                <p className="lp-gate-verdict-why">
                  known drainer — 0x6160…3757e is on the curated deny list, cited from an
                  approval-drain advisory. The agent never signs.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className="lp-proof" aria-label="Facts">
          <div className="lp-wrap lp-proof-grid">
            <div className="lp-proof-item">
              <div className="lp-proof-value">5</div>
              <div className="lp-proof-label">tools, one job each</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">2</div>
              <div className="lp-proof-label">third-party runtime deps</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">0</div>
              <div className="lp-proof-label">keys held · shell · telemetry</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">$0.002</div>
              <div className="lp-proof-label">per call, hosted API</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">MIT</div>
              <div className="lp-proof-label">source, tests and CI public</div>
            </div>
          </div>
        </section>

        <AliveStrip />

        <section className="lp-section" id="how">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">How it works</h2>
              <p className="lp-h2-note">
                Three steps, all local. The only network calls are an RPC read and a
                read-only market query.
              </p>
            </div>

            <div className="lp-steps">
              <article className="lp-step">
                <div className="lp-step-n">01</div>
                <h3>The agent proposes a payment</h3>
                <p>
                  Any x402 request, MCP purchase, authorised transfer or HIP-3 order — the
                  same object the agent is about to sign.
                </p>
              </article>
              <article className="lp-step">
                <div className="lp-step-n">02</div>
                <h3>PayStage evaluates it</h3>
                <p>
                  Your policy file decides: cap, allowlist, unknown payee, outstanding
                  authorisations, velocity. Every check returns a reason, not a score.
                </p>
              </article>
              <article className="lp-step">
                <div className="lp-step-n">03</div>
                <h3>The agent gets a verdict</h3>
                <p>
                  <code>pay</code> proceeds, <code>review</code> escalates to a human,{" "}
                  <code>do_not_pay</code> blocks with the rule that fired.
                </p>
              </article>
            </div>

            <pre className="lp-code" style={{ marginTop: 20 }}>
              <code>
                <span className="c">{"// policy.json — the whole configuration surface"}</span>
                {"\n"}
                {"{"}
                {"\n  "}
                <span className="k">&quot;max_amount&quot;</span>: {"{ "}
                <span className="k">&quot;value&quot;</span>:{" "}
                <span className="s">&quot;1.00&quot;</span>,{" "}
                <span className="k">&quot;asset&quot;</span>:{" "}
                <span className="s">&quot;USDC&quot;</span> {"},"}
                {"\n  "}
                <span className="k">&quot;allowed_networks&quot;</span>: [
                <span className="s">&quot;eip155:8453&quot;</span>],
                {"\n  "}
                <span className="k">&quot;unknown_payee&quot;</span>:{" "}
                <span className="s">&quot;review&quot;</span>
                {"\n"}
                {"}"}
              </code>
            </pre>
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="why">
          <div className="lp-wrap lp-split">
            <div className="lp-body">
              <h2 className="lp-h2" style={{ marginBottom: 18 }}>
                Why now
              </h2>
              <p>
                Agents transact autonomously, and the tooling around them has grown faster
                than the safety layer. A wallet enforces signing; it does not enforce
                intent. There is no approval step between{" "}
                <strong>&quot;the agent decided to pay&quot;</strong> and{" "}
                <strong>&quot;the payment is irreversible&quot;</strong>.
              </p>
              <p>
                Settlement is getting easier every month — x402 makes paying an HTTP
                endpoint a single request. That is the point where a bad payee, a
                lookalike listing or a compromised agent turns into money that has already
                moved. The check has to happen before the signature, locally, in the
                agent&apos;s own process.
              </p>
              <p>
                PayStage&apos;s wedge is not another risk score. It is a{" "}
                <strong>deterministic, cited verdict</strong>: which rule fired, and for
                deny-listed addresses, the public advisory it came from.
              </p>
            </div>

            <div>
              <ul className="lp-checks">
                <li>
                  <span className="x" aria-hidden="true">
                    ✕
                  </span>
                  <span>
                    Wallets will sign any transaction the agent constructs — they are not
                    a policy engine.
                  </span>
                </li>
                <li>
                  <span className="x" aria-hidden="true">
                    ✕
                  </span>
                  <span>
                    Marketplace listings and MCP servers can be cloned; the endpoint name
                    proves nothing about who receives the funds.
                  </span>
                </li>
                <li>
                  <span className="x" aria-hidden="true">
                    ✕
                  </span>
                  <span>
                    Spend caps inside an agent are advisory: the same process that
                    enforces them can be talked out of them.
                  </span>
                </li>
                <li>
                  <span className="x" aria-hidden="true">
                    ✕
                  </span>
                  <span>
                    A hosted scoring API adds a network hop and a trust assumption at
                    exactly the wrong moment.
                  </span>
                </li>
              </ul>
              <p className="lp-hero-note" style={{ marginTop: 20 }}>
                PayStage runs in the agent&apos;s process, reads one policy file, and
                fails closed.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-section" id="agents">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">For agents</h2>
              <p className="lp-h2-note">
                Machine-readable and verifiable. No prose required, nothing to trust on
                faith.
              </p>
            </div>

            <table className="lp-table">
              <thead>
                <tr>
                  <th scope="col">Surface</th>
                  <th scope="col">What it gives you</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>/llms.txt</code>
                  </td>
                  <td>Short map: what this is, the five tools, install lines, endpoints.</td>
                </tr>
                <tr>
                  <td>
                    <code>/llms-full.txt</code>
                  </td>
                  <td>
                    Long form: tool schemas, verdict semantics, policy schema, error
                    shapes, access surface.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>/.well-known/paystage.json</code>
                  </td>
                  <td>
                    Manifest: tool list, verdict enum, runtime dependencies, env vars,
                    network endpoints, <code>holds_keys: false</code>, provenance and
                    audit links.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>registry.modelcontextprotocol.io</code>
                  </td>
                  <td>
                    MCP Registry entry <code>xyz.paystage/mcp</code> for discovery and
                    install.
                  </td>
                </tr>
              </tbody>
            </table>

            <h3 className="lp-h2" style={{ fontSize: 18, margin: "38px 0 12px" }}>
              Sixty-second verification
            </h3>
            <pre className="lp-code">
              <code>
                <span className="c"># 1. starts with no key and no config</span>
                {"\n"}npx -y @paystage/mcp{"\n\n"}
                <span className="c"># 2. run one evaluation against the example policy</span>
                {"\n"}
                <span className="c">{"#    → returns review, with a named reason"}</span>
                {"\n\n"}
                <span className="c"># 3. provenance is real, not claimed</span>
                {"\n"}npm audit signatures{"\n\n"}
                <span className="c"># 4. read the access table before you trust it</span>
                {"\n"}open https://github.com/base-buzz/paystage/blob/main/SECURITY.md
              </code>
            </pre>
            <p className="lp-hero-note">
              If any step fails, the page is wrong — open an issue and it gets fixed that
              week.
            </p>
          </div>
        </section>

        <CadencePanel />

        <section className="lp-section" id="evidence">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">Safety, as artifacts</h2>
              <p className="lp-h2-note">
                A safety product earns trust with evidence, not adjectives.
              </p>
            </div>

            <div className="lp-cards">
              <a
                className="lp-card"
                href="https://github.com/base-buzz/paystage/blob/main/SECURITY.md"
                rel="noopener"
              >
                <span className="lp-card-tag">SECURITY.md</span>
                <h3>What it touches, and why</h3>
                <p>
                  One policy file read, two environment variables, two read-only
                  endpoints. No shell, no eval, no telemetry, no key custody.
                </p>
              </a>
              <a
                className="lp-card"
                href="https://github.com/base-buzz/paystage/blob/main/packages/preflight/KNOWN_DRAINERS.md"
                rel="noopener"
              >
                <span className="lp-card-tag">KNOWN_DRAINERS.md</span>
                <h3>Every deny entry is cited</h3>
                <p>
                  Each address carries a public source and a retrieval date. No source, no
                  address — the list is curated for precision over recall.
                </p>
              </a>
              <a className="lp-card" href="https://www.npmjs.com/package/@paystage/mcp" rel="noopener">
                <span className="lp-card-tag">npm provenance</span>
                <h3>Built in CI, signed by OIDC</h3>
                <p>
                  Releases publish from GitHub Actions with provenance via Trusted
                  Publishing. Verify with <code>npm audit signatures</code>.
                </p>
              </a>
              <a
                className="lp-card"
                href="https://github.com/base-buzz/paystage/blob/main/CHANGELOG.md"
                rel="noopener"
              >
                <span className="lp-card-tag">CHANGELOG</span>
                <h3>One real release a week</h3>
                <p>
                  Every version is a code or list change with a reason. No no-op bumps, no
                  download games.
                </p>
              </a>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">The five tools</h2>
              <p className="lp-h2-note">
                Installed together by <code>npx -y @paystage/mcp</code>, or one package at
                a time.
              </p>
            </div>
            <table className="lp-table">
              <tbody>
                {TOOLS.map(([name, desc]) => (
                  <tr key={name}>
                    <td style={{ width: "38%" }}>
                      <code>{name}</code>
                    </td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lp-hero-note">
              Also available as a hosted pay-per-call API on Base mainnet (
              <code>api.paystage.xyz</code>) and Base Sepolia, $0.002 USDC per call.
            </p>
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
              <a href="https://github.com/base-buzz/paystage" rel="noopener">
                GitHub
              </a>
              <a href="https://www.npmjs.com/package/@paystage/mcp" rel="noopener">
                npm
              </a>
              <a href="/llms.txt">llms.txt</a>
              <a href="/console">Console</a>
              <a href="https://github.com/base-buzz/paystage/security/advisories/new" rel="noopener">
                Report a vulnerability
              </a>
            </nav>
          </div>
          <p className="lp-fine">
            PayStage evaluates payment requests against a policy you write and returns a
            decision; it holds no keys, signs nothing, and never moves funds. The
            HIP-3/trade tool is a local policy gate, not financial advice. Early-stage
            software: read the source, run the tests, report what breaks.
          </p>
        </div>
      </footer>
    </div>
  );
}
