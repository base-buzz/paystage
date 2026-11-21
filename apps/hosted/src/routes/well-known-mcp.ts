/**
 * `/.well-known/mcp.json` — the server card an MCP-native crawler looks for first.
 *
 * We already publish `/.well-known/paystage.json`, which is ours alone: useful to a reader, invisible to a
 * crawler that only knows the convention. This is the standard shape, and it describes the same server, so
 * there is one source of truth below rather than two files to keep in step.
 */
import { Hono } from "hono";

export const wellKnownMcpRoutes = new Hono();

wellKnownMcpRoutes.get("/.well-known/mcp.json", (c) => {
  const body = {
    // SEP-1649 server card: transport, endpoint, and what the server can do.
    $schema: "https://static.modelcontextprotocol.io/schemas/mcp-server-card.schema.json",
    name: "io.github.base-buzz/x402-payment-safety",
    title: "PayStage — x402 payment safety",
    description:
      "x402 payment safety: stop your agent paying a drainer before the wallet signs. Nine MCP tools return pay / review / do_not_pay with the rule that fired — policy evaluation, outstanding authorisations, velocity checks, OFAC sanctions screening and signed receipts. Read-only: holds no keys, never signs.",
    version: "2026.11.16",
    websiteUrl: "https://paystage.xyz",
    repository: { url: "https://github.com/base-buzz/paystage", source: "github" },
    transports: [
      {
        type: "streamable-http",
        url: "https://api.paystage.xyz/mcp",
        // Paid tools exist alongside free ones; a crawler that only reads this file still needs to know.
        payment: { protocol: "x402", network: "eip155:8453", asset: "USDC" },
      },
      {
        type: "stdio",
        package: { registryType: "npm", identifier: "@paystage/mcp", version: "0.8.2" },
      },
    ],
    capabilities: { tools: { listChanged: false } },
    // The words an agent searches with, in the file a crawler reads.
    keywords: ["x402", "payment safety", "spend limits", "drainer", "guard", "usdc", "base", "eip155:8453"],
    documentation: "https://paystage.xyz/llms.txt",
    limits: "https://github.com/base-buzz/paystage/blob/main/LIMITS.md",
  };
  return c.json(body, 200, {
    "cache-control": "public, max-age=3600",
    // Discovery files are read cross-origin by agent frameworks.
    "access-control-allow-origin": "*",
  });
});
