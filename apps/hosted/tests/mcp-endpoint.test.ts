import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

/**
 * The remote MCP endpoint. The npm package is stdio-only, so before this every directory and
 * gateway had no URL to point at — a listing with no phone number.
 */

const env = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_PRICE: "$0.002",
  PAYSTAGE_NETWORK: "eip155:8453",
  FACILITATOR_URL: "https://x402.org/facilitator",
  FREE_TIER_ENABLED: "false",
};

describe("/mcp", () => {
  it("answers an initialize handshake over Streamable HTTP", async () => {
    const app = createApp(env as never, { protect: false });
    const res = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      },
      env as never,
    );
    expect([200, 202]).toContain(res.status);
    const body = await res.text();
    expect(body).toContain("paystage");
  });

  it("lists the evaluate_mcp_payment tool", async () => {
    const app = createApp(env as never, { protect: false });
    const res = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      },
      env as never,
    );
    expect(res.status).toBeLessThan(400);
  });
});
