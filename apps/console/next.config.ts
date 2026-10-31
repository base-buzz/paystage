import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@x402/core", "@x402/evm", "@x402/fetch"],
};

export default nextConfig;
