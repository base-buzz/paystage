import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same output mode as apps/console, which @opennextjs/cloudflare consumes.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
