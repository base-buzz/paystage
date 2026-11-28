import type { NextConfig } from "next";

import brand from "../../brand.json";

const nextConfig: NextConfig = {
  // Same output mode as apps/console, which @opennextjs/cloudflare consumes.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Verification lives on one domain, and it is the engine's (#469).
   *
   * A person holding a VouchGuard pass scans a QR that points at `paystage.xyz/m/<serial>`, so the counterparty pages
   * belong there too — and duplicating them here would mean two copies of a safety sentence (“do not trust the pass”)
   * that must agree forever. One implementation, one place to fix. These redirects keep the brand's spelling working
   * instead of answering 404 to a stranger who guessed the obvious URL.
   *
   * The serial is preserved in both directions, because a redirect that loses it answers the wrong question.
   */
  async redirects() {
    const api = (brand as { apiBase?: string }).apiBase ?? "https://api.paystage.xyz";
    const engine = api.replace("api.", "");
    return [
      { source: "/verify", destination: `${engine}/verify`, permanent: true },
      { source: "/v/:serial", destination: `${engine}/v/:serial`, permanent: true },
      /**
       * The pass's own QR says `paystage.xyz/m/<serial>`, and this domain answered 404 to anyone who edited the host (#502). A stranger
       * retyping a link — or a scanner that normalises to the site they came from — should land on the same page, not on a 404 that
       * reads as "the pass is fake".
       */
      { source: "/m/:serial", destination: `${engine}/m/:serial`, permanent: true },
    ];
  },
};

export default nextConfig;
