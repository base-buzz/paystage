import type { Metadata } from "next";
import "./landing.css";
import { AliveStrip } from "@/components/AliveStrip";
import { ChartStrip } from "@/components/ChartStrip";
import { CopyCommand } from "@/components/CopyCommand";
import { LogoBanner } from "@/components/LogoBanner";
import { AgentPrompt } from "@/components/AgentPrompt";
import { ScrollReveal } from "@/components/ScrollReveal";
import { CadencePanel } from "@/components/CadencePanel";
import { LiveFeed } from "@/components/LiveFeed";
import { LatencyBadge } from "@/components/LatencyBadge";
import { ChainTicker } from "@/components/ChainTicker";
import { SettledStrip } from "@/components/SettledStrip";
import { FunnelPanel } from "@/components/FunnelPanel";
import { SOCIALS } from "@/lib/agent-manifest";
import {
  AGENT_CATEGORIES,
  AGENT_SURFACES,
  AGENT_SURFACE_LABELS,
  type AgentSurfaceProduct,
} from "@/lib/agent-surfaces";
import { TOOL_COUNT, TOOL_COUNT_WORD } from "@/lib/tools";
import refusalExample from "@/lib/refusal-example.json";

// Page-level metadata replaces the layout's `openGraph` object wholesale rather than merging into it,
// so the image declared in layout.tsx never reached the page that matters. Declared here in full, and
// the description is 148 characters because Google truncates around 150–160 — at 211 the clause
// saying what the tool does was the part being cut.
export const metadata: Metadata = {
  title: "PayStage — Safety tools for AI agent payments",
  description:
    "Read-only preflight for AI agent payments: get pay, review or do-not-pay before anything is signed, with the rule that fired.",
  alternates: { canonical: "https://paystage.xyz/" },
  openGraph: {
    title: "Stop the payment before it's signed.",
    description:
      "Read-only preflight for AI agent payments: pay, review or do-not-pay — with the rule that fired.",
    url: "https://paystage.xyz/",
    siteName: "PayStage",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "PayStage — stop the payment before it's signed" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stop the payment before it's signed.",
    description: "Read-only preflight for AI agent payments. Pay, review or do-not-pay — with the rule that fired.",
    images: ["/og.png"],
  },
};

const TOOLS = [
  ["evaluate_mcp_payment", "verify the recipient. Call this BEFORE signing any x402 payment. Verdict is pay · review · do_not_pay"],
  ["evaluate_batch", "transaction scope. several payments against one policy · one verdict each, in order"],
  ["list_outstanding_auths", "spending limits. ERC-20, Permit2 and EIP-3009 authorisations still outstanding"],
  ["evaluate_outstanding_auths", "spending limits. flags authorisations needing attention before the next payment"],
  ["evaluate_hip3_trade", "transaction scope. HIP-3 / trade.xyz order vs. your TradePolicy → allow · review · do_not_trade"],
  ["evaluate_velocity", "transparent risk assessments. rolling rate and spend checks: bursts, spikes, runaway cadence"],
  ["verify_receipt", "verify the recipient. check a receipt against the published signing key"],
  ["decode_payment_required", "verify the recipient. turn a 402 header into the JSON challenge, so an agent can look before it leaps"],
  ["validate_policy", "spending limits. check a policy document on its own — the question behind most support requests"],
  ["request_testnet_funds", "test funds. 0.5 Base Sepolia USDC so an agent can try the paid path — one drip per address per 24h, and the refusal says when it resets"],
] as const;

const SURFACE_TRAITS: Record<string, string> = {
  persistent: "persistent",
  "computer-use": "computer-use",
  teammate: "AI teammate",
};

const SURFACE_REACH: Record<AgentSurfaceProduct["state"], string> = {
  reachable: "Can reach an MCP server: yes.",
  "documented-not-listed": "MCP: supported, but not in the list it reads.",
  "no-mcp": "MCP: no external server.",
  unverified: "Can reach an MCP server: unverified.",
};

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The example card names a payee once; the full address stays in the JSON it was generated from. */
function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Structured data, for the crawlers agents actually read (#discovery).
 *
 * An agent that reaches this page through a search result gets HTML, not our llms.txt. JSON-LD is what makes the page
 * legible as a *tool* rather than as marketing: what it is, what it costs, that it needs no account, and the questions
 * it answers. Google, Bing and the retrieval layers agents use all parse `application/ld+json`.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "PayStage",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any (MCP over stdio, HTTP)",
      url: "https://paystage.xyz",
      description:
        "x402 payment safety for AI agents: evaluate a payment against your policy before the wallet signs. Returns pay, review or do_not_pay with the rule that fired. Read-only, holds no keys, never signs.",
      offers: { "@type": "Offer", price: "0.002", priceCurrency: "USD", description: "Per hosted evaluation over x402; the packages are free and MIT licensed." },
      isAccessibleForFree: true,
      license: "https://github.com/base-buzz/paystage/blob/main/LICENSE",
      featureList: [
        "Preflight an x402 payment against a local policy before signing",
        "Flag payees on a cited known-drainer list, and payees that are non-receivable",
        "List and evaluate outstanding ERC-20, Permit2 and EIP-3009 authorisations",
        "Evaluate spend velocity, HIP-3 order scope and batch payments",
        "Verify a signed receipt against a published key set",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "How does an agent check an x402 payment before signing it?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Call the evaluate_mcp_payment tool with the decoded x402 challenge and a policy. It returns pay, review or do_not_pay with the rule that fired, and never signs or moves funds.",
          },
        },
        {
          "@type": "Question",
          name: "Does PayStage hold keys or sign transactions?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. It is read-only: no key custody, no shell, no telemetry. The agent remains the only signer, which is enforced by what the code does rather than by policy.",
          },
        },
        {
          "@type": "Question",
          name: "Can it be used without an account?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. There is no signup: the packages are MIT licensed and run locally, and the hosted API answers the first 1,000 evaluations a day at no cost — counted per Worker instance, so the effective allowance scales with instances rather than being a global cap — then 0.002 USDC per call over x402.",
          },
        },
      ],
    },
  ],
};

export default function LandingPage() {
  return (
    <div className="lp">


      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <main>
      {/* Atmospheric background: three drifting colour fields plus a grain overlay. Fixed,
          purely decorative, and disabled under prefers-reduced-motion. */}
      <div className="lp-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-grain" aria-hidden="true" />
      <ScrollReveal />
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <p className="lp-eyebrow">
                x402 · MCP · USDC on Base — the third party outside your wallet that decides before your agent signs
              </p>
              <h1 className="lp-h1">
                Stop the payment <em>before</em> it&apos;s signed.
              </h1>
              <p className="lp-lede">
                AI agents now pay for things on their own — x402 APIs, MCP servers, perp
                venues. Wallets sign whatever the agent asks and nothing checks whether
                it should. PayStage is a read-only seatbelt outside the wallet:{" "}
                <strong>
                  {TOOL_COUNT_WORD} small MCP tools
                </strong>{" "}
                that evaluate a proposed payment
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
                <CopyCommand command="npx -y -p @paystage/mcp paystage-mcp" />
              </div>
              {/* The structural argument, directly under the hero: a payment has two jobs and the
                  wallet can only credibly do the first. It says why a third party exists at all,
                  which the three bullets below (empirical objections) do not. */}
              <p className="lp-lede" style={{ marginTop: 18 }}>
                <strong>A payment has two jobs: making it, and deciding whether it should happen.</strong>{" "}
                The wallet does the first. It cannot credibly do the second — it is the party whose
                revenue depends on the answer. PayStage is the third party: no keys, no funds, no
                listings. It returns a verdict with the rule that fired, and a receipt anyone can
                verify without trusting us.
              </p>
              {/* The risk reducer belongs beside the CTA, not in 12px grey under it — these are
                  the three objections that stop a payment-safety tool being tried. */}
              <ul className="lp-reassure">
                <li>MIT licensed — the whole evaluator, not a demo build</li>
                <li>holds no keys and never signs; the agent is still the only signer</li>
                <li>no account, no email: an agent cannot fill in a signup form</li>
              </ul>

              <AgentPrompt />
            </div>

            <aside className="lp-gate" aria-label="Example evaluation">
              <div className="lp-gate-head">
                <span>one evaluation</span>
                <LatencyBadge />
              </div>
              <div className="lp-gate-row">
                <span aria-hidden="true">→</span>
                <code>payTo 0x6160…3757 · 12.50 USDC</code>
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
                  known drainer — 0x6160…3757 is on the curated deny list, cited from an
                  approval-drain advisory. The agent never signs.
                </p>
              </div>
            </aside>
          </div>
        </section>


        <section className="lp-wrap" aria-label="Where this is verifiable">
          <div className="lp-badges">
            <a
              className="lp-badge lp-glass"
              href="https://registry.modelcontextprotocol.io/v0/servers?search=io.github.base-buzz"
            >
              <span className="dot" aria-hidden="true" />
              listed in the MCP Registry
            </a>
            <a className="lp-badge lp-glass" href="https://glama.ai/mcp/servers/base-buzz/paystage">
              <span className="dot" aria-hidden="true" />
              listed on Glama
            </a>
            <a className="lp-badge lp-glass" href="https://www.npmjs.com/package/@paystage/mcp">
              <span className="dot" aria-hidden="true" />
              npm · published with provenance
            </a>
            <a
              className="lp-badge lp-glass"
              href="https://github.com/base-buzz/paystage/blob/main/LICENSE"
            >
              <span className="dot" aria-hidden="true" />
              MIT licensed
            </a>
            <a
              className="lp-badge lp-glass"
              href="https://github.com/coinbase/x402"
            >
              <span className="dot" aria-hidden="true" />
              builds on x402 · Base
            </a>
            <span className="lp-badge lp-glass lp-badge-static">
              <span className="dot" aria-hidden="true" />
              runs on Cloudflare Workers
            </span>
            <a className="lp-badge lp-glass" href="https://arcade.dev">
              <span className="dot" aria-hidden="true" />
              callable through Arcade
            </a>
          </div>
        </section>

        {/* Before the counts: a reader should see what a refusal is before reading a number.
            This is one refusal exported from the stored receipts by scripts/refusal-summary.mjs
            (--example-out); the page never fetches it at render. */}
        <section className="lp-wrap lp-refusal" aria-label="A stored refusal">
          <div className="lp-refusal-card">
            <div className="lp-refusal-top">
              <span className="lp-refusal-eyebrow">one refusal, from the stored receipts</span>
              <span className="lp-refusal-verdict">{refusalExample.decision}</span>
            </div>
            <p className="lp-refusal-rule">
              <span className="lp-refusal-label">rule that fired</span>
              <code>{refusalExample.rule}</code>
            </p>
            <div className="lp-refusal-facts">
              <span className="lp-refusal-amount">{refusalExample.amount}</span>
              <span>
                to <code>{shortAddress(refusalExample.payee)}</code>
              </span>
              {refusalExample.serial ? (
                <span>
                  mandate <code>{refusalExample.serial}</code>
                </span>
              ) : null}
            </div>
            <p className="lp-refusal-note">
              A refusal is data, not an exception: the amount, the payee, and the rule the evaluator
              fired. It is what a limit did, in a form the agent can act on.
            </p>
          </div>
        </section>

        <section className="lp-proof" aria-label="Facts">
          <div className="lp-wrap lp-proof-grid">
            <div className="lp-proof-item">
              <div className="lp-proof-value">{TOOL_COUNT}</div>
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

        <section className="lp-wrap" aria-label="Live activity">
          <ChainTicker endpoint={process.env.NEXT_PUBLIC_CHAIN_ENDPOINT ?? "https://api.paystage.xyz/v1/public/chain.json"} />
          <SettledStrip />
          <FunnelPanel />
        </section>

        <LiveFeed />

        <LogoBanner />

        <ChartStrip />

        <AliveStrip />

        <section className="lp-section" id="how" data-reveal>
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

        <section className="lp-section lp-section-alt" id="why" data-reveal>
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

        <section className="lp-section" id="agents" data-reveal>
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
                  <td>Short map: what this is, the ten tools, install lines, endpoints.</td>
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
                    MCP Registry entry <code>io.github.base-buzz/x402-payment-safety</code> for discovery and
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
                {"\n"}npx -y -p @paystage/mcp paystage-mcp{"\n\n"}
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

        <section className="lp-section lp-section-alt" id="discovery" data-reveal>
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">Discovery</h2>
              <p className="lp-h2-note">
                Which always-on agent products could call a gate — and which one we
                cannot yet verify.
              </p>
            </div>

            <p className="lp-surface-lede">
              The roster below is the operator&apos;s, not a ranking: no product here
              publishes usage numbers. Two primary facts are recorded — whether the
              product&apos;s own documentation describes a way to add an external MCP
              server, and whether our endpoint answers <code>initialize</code>. A row
              marked <strong>reachable</strong> means both are true; it does not mean the
              product lists, recommends or supports PayStage.
            </p>

            <div className="lp-surface-endpoint">
              <div className="lp-surface-endpoint-main">
                <span className="lp-surface-endpoint-tag">MCP endpoint</span>
                <a href={AGENT_SURFACES.endpoint.url} rel="noopener">
                  <code>{AGENT_SURFACES.endpoint.url}</code>
                </a>
              </div>
              <p>
                Streamable HTTP. POST <code>initialize</code> and the server answers as{" "}
                <code>{AGENT_SURFACES.endpoint.serverName ?? "paystage"}</code>. Checked{" "}
                {AGENT_SURFACES.endpoint.checkedAt}
                {AGENT_SURFACES.endpoint.ok ? " — answered" : " — did not answer"}.
              </p>
            </div>

            <div className="lp-surface-kinds">
              {AGENT_CATEGORIES.map((category) => (
                <div className="lp-surface-kind" key={category.id}>
                  <strong>{category.label}</strong>
                  <p>{category.blurb}</p>
                </div>
              ))}
            </div>

            {AGENT_CATEGORIES.filter((category) => category.id !== "chatbot").map((category) => {
              const products = AGENT_SURFACES.products.filter(
                (product) => product.category === category.id,
              );
              return (
                <section className="lp-surface-group" key={category.id} aria-label={category.label}>
                  <div className="lp-surface-group-head">
                    <h3>{category.label}</h3>
                    <span>{products.length} on the roster</span>
                  </div>
                  <div className="lp-surface-grid">
                    {products.map((product) => (
                      <article className="lp-surface-card" key={product.id}>
                        <div className="lp-surface-card-top">
                          <div className="lp-surface-traits">
                            {product.traits.map((trait) => (
                              <span className="lp-surface-trait" key={trait}>
                                {SURFACE_TRAITS[trait] ?? trait}
                              </span>
                            ))}
                          </div>
                          <span className={`lp-surface-state is-${product.state}`}>
                            {AGENT_SURFACE_LABELS[product.state]}
                          </span>
                        </div>
                        <h4>
                          {product.product}
                          <span className="lp-surface-vendor">{product.vendor}</span>
                        </h4>
                        <p>{product.what}</p>
                        <p className="lp-surface-reach">
                          <strong>{SURFACE_REACH[product.state]}</strong> {product.reason}
                        </p>
                        {product.note ? <p className="lp-surface-note">{product.note}</p> : null}
                        <p className="lp-surface-source">
                          {product.sources.map((source, index) => (
                            <span key={source.url}>
                              <a href={source.url} rel="noopener">
                                {sourceHost(source.url)}
                              </a>
                              {index < product.sources.length - 1 ? " · " : ""}
                            </span>
                          ))}
                          <span> — read {product.checkedAt}</span>
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

            <div className="lp-surface-chatbots">
              <h3>Chatbots — not this list</h3>
              <p>
                The Q&amp;A interfaces these products are not. A chat tab answers when you
                type; it has no routine, no standing browser session and no teammate to
                hand work to. Nothing on the roster above is a chatbot, which is the
                distinction that makes the rest worth checking one by one.
              </p>
            </div>

            <p className="lp-surface-foot">
              {AGENT_SURFACES.counts.reachable} of {AGENT_SURFACES.products.length} rows
              document a path to an external MCP server; {AGENT_SURFACES.counts.unverified}{" "}
              has no primary source that says either way and is shown as unverified rather
              than filled from a blog. Each row was read on {AGENT_SURFACES.checkedOn}; the
              probe used {AGENT_SURFACES.requestBudget.used} of{" "}
              {AGENT_SURFACES.requestBudget.limit} requests. Data:{" "}
              <code>docs/state/agent-surfaces.json</code>.
            </p>
          </div>
        </section>

        <CadencePanel />

        <section className="lp-section" id="evidence" data-reveal>
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
                  One policy file read, two environment variables, and calls that
                  only ever read. No shell, no eval, no telemetry, no key custody.
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
              {/*
                One filed upstream finding, and it is named. #102 asked for "we have filed N upstream security findings" as a
                verifiable claim; the number is one, so the card says one and links the issue. A count with a link is checkable, a
                badge is not — and ops runs `check-outbound-parity.mjs` against the ledger so this cannot drift from what was filed.
              */}
              <a
                className="lp-card"
                href="https://github.com/Libertai/libertai-agents/issues/161"
                rel="noopener"
              >
                <span className="lp-card-tag">1 upstream report</span>
                <h3>Filed where the bug was</h3>
                <p>
                  When we find a payment path that signs without checking the payee, we report it upstream with reproduction
                  steps. One filed, open, linked here.
                </p>
              </a>
              <a className="lp-card" href="/ai-sdk">
                <span className="lp-card-tag">@paystage/ai-sdk</span>
                <h3>Works with the Vercel AI SDK</h3>
                <p>
                  Decides whether a payment may be signed, inside the same loop that would sign it.
                  Read-only — the tool that decides is not the tool that spends.
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
              <h2 className="lp-h2">The {TOOL_COUNT_WORD} tools</h2>
              <p className="lp-h2-note">
                Installed together by <code>npx -y -p @paystage/mcp paystage-mcp</code>, or one package at
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
      
        <section className="lp-section" id="faq" data-reveal>
          <div className="lp-wrap">
            <h2 className="lp-h2">Questions a careful reader asks</h2>
            <div className="lp-faq">
              {[
                {
                  q: "Does it work with my stack?",
                  a: "The package is a standard stdio MCP server, so anything that speaks MCP works: Claude Desktop, Cursor, Cline, VS Code, and any agent framework with an MCP client. The hosted endpoint is plain HTTP, so nothing needs to be installed for that path.",
                },
                {
                  q: "Is this maintained?",
                  a: "Releases are automated: a canary publishes daily from main, and stable versions publish on a tag, both with npm provenance. The commit history, CI logs and release notes are public, so you can check rather than take our word.",
                },
                {
                  q: "Can I see the code before trusting it?",
                  a: "Yes — it is MIT, and the evaluator that produces a verdict is the same code the tests run. The receipt vectors in the repo can be checked with sha256sum without installing anything.",
                },
                {
                  q: "What does it not cover?",
                  a: "Post-settlement reversals, colluding payees, and any promise made off-chain. The gate decides whether to sign; it cannot un-spend money, and it does not know what a seller does after it is paid.",
                },
                {
                  q: "Does it hold my keys?",
                  a: "No. It returns a verdict and never signs. Your agent remains the only signer, and that is enforced by what the code does rather than by policy.",
                },
                {
                  q: "What does a call cost?",
                  a: "The first 1,000 evaluations a day are free with no account. The counter lives in Worker isolate memory, so the allowance is per instance rather than a global per-IP cap — the status endpoint publishes that caveat beside the number. Beyond it the hosted API is $0.002 per call, paid over x402. The packages are free and MIT licensed.",
                },
              ].map((item) => (
                <details className="lp-faq-item" key={item.q}>
                  <summary className="lp-faq-q">{item.q}</summary>
                  <p className="lp-faq-a">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-cta-final" data-reveal>
          <div className="lp-wrap">
            <h2 className="lp-h2">Try it before you trust it</h2>
            <p className="lp-hero-note" style={{ maxWidth: 620 }}>
              One real evaluation, no install: a stranger can send a payment challenge to the
              hosted API and see the verdict their agent would have received.
            </p>
            <div className="lp-actions" style={{ marginTop: 22 }}>
              <a className="lp-btn lp-btn-primary" href="/try">
                Run a real evaluation
              </a>
              <a className="lp-btn lp-btn-ghost" href="https://github.com/base-buzz/paystage" rel="noopener">
                Read the source
              </a>
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
            <nav className="lp-footer-nav" aria-label="Listed on">
              {/* The listings we are actually on, linked from the page that claims them. */}
              <a href="https://www.x402scan.com/server/71d358eb-0ef8-4d6d-8356-91c5bc237fb0" rel="noopener">
                x402scan
              </a>
              <a href="https://glama.ai/mcp/servers/base-buzz/paystage" rel="noopener">
                Glama
              </a>
              <a
                href="https://registry.modelcontextprotocol.io/v0/servers?search=io.github.base-buzz"
                rel="noopener"
              >
                MCP registry
              </a>
            </nav>
            <nav className="lp-footer-nav" aria-label="Footer">
              {SOCIALS.map((social) => (
                <a key={social.label} href={social.url} rel="me noopener">
                  {social.label}
                </a>
              ))}
              <a href="https://www.npmjs.com/package/@paystage/mcp" rel="noopener">
                npm
              </a>
              <a href="/llms.txt">llms.txt</a>
              <a href="/console">Console</a>
              <a href="/state-of-x402">State of x402</a> · <a href="/lists">Deny lists</a> · <a href="/compare">Compare</a> · <a href="/glossary">Glossary</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a> · <a href="/contact">Contact</a>
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
