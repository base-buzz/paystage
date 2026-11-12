/**
 * The platform wall — chainstack/infura pattern: full-bleed, monochrome, two tiers.
 *
 * Two tiers because the relationships are different and flattening them would overclaim:
 *   "built on / runs on"        — infrastructure we depend on
 *   "listed in / callable through" — directories and runtimes that accept us
 *
 * Nothing here is a partnership. Coinbase and Circle appear as text with the relationship
 * beside them rather than as bare logos, because a bare mark next to our product reads as
 * endorsement and neither company has endorsed anything.
 */

const BUILT_ON = [
  { label: "Base", note: "settlement network", href: "https://base.org" },
  { label: "x402", note: "the protocol we gate", href: "https://github.com/coinbase/x402" },
  { label: "USDC", note: "the asset we cap", href: "https://www.circle.com/usdc" },
  { label: "Coinbase CDP", note: "facilitator", href: "https://docs.cdp.coinbase.com" },
  { label: "Cloudflare", note: "workers + dns", href: "https://workers.cloudflare.com" },
  { label: "Supabase", note: "telemetry", href: "https://supabase.com" },
];

const CALLABLE = [
  { label: "MCP Registry", note: "listed · remote entry", href: "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.base-buzz" },
  { label: "Glama", note: "listed · claimed", href: "https://glama.ai/mcp/servers/base-buzz/paystage" },
  { label: "mcp.so", note: "listed", href: "https://mcp.so/servers/paystage-6d8a8f" },
  { label: "Arcade", note: "callable · worker", href: "https://arcade.dev" },
  { label: "npm", note: "7 packages · provenance", href: "https://www.npmjs.com/package/@paystage/mcp" },
  { label: "GitHub", note: "MIT · public CI", href: "https://github.com/base-buzz/paystage" },
];

function Row({ items }: { items: typeof BUILT_ON }) {
  // Rendered twice: the second copy is what makes the loop seamless. aria-hidden on the
  // duplicate so a screen reader hears each platform once.
  return (
    <div className="lp-marquee-track">
      {[0, 1].map((copy) => (
        <ul className="lp-logos" key={copy} aria-hidden={copy === 1 ? "true" : undefined}>
          {items.map((p) => (
            <li key={`${copy}-${p.label}`}>
              <a className="lp-logo" href={p.href} rel="noopener" tabIndex={copy === 1 ? -1 : undefined}>
                <span className="lp-logo-mark">{p.label}</span>
                <span className="lp-logo-note">{p.note}</span>
              </a>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export function LogoBanner() {
  return (
    <section className="lp-band lp-band-logos" aria-label="Platforms">
      <div className="lp-band-inner lp-band-inner-wide">
        <p className="lp-logos-label">built on · runs on</p>
        <div className="lp-marquee">
          <Row items={BUILT_ON} />
        </div>
        <p className="lp-logos-label lp-logos-label-second">listed in · callable through</p>
        <div className="lp-marquee">
          <Row items={CALLABLE} />
        </div>
      </div>
    </section>
  );
}
