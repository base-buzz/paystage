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
    ];
  },
};

export default nextConfig;
