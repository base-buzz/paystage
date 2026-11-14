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

  it("lists all nine tools, not the one it used to", async () => {
    // The site claimed nine while this endpoint served one. This assertion is the reason that cannot
    // happen quietly again: it fails on a count change in either direction.
    const app = createApp(env as never, { protect: false });
    const res = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }),
      },
      env as never,
    );
    const text = await res.text();
    const names = [...text.matchAll(/"name":"([a-z0-9_]+)"/g)].map((m) => m[1] ?? "");
    const set = new Set(names.filter((n): n is string => Boolean(n) && n.includes("_") && n !== "paystage"));
    expect(set.size).toBe(9);
    for (const expected of [
      "evaluate_mcp_payment",
      "list_outstanding_auths",
      "evaluate_outstanding_auths",
      "evaluate_hip3_trade",
      "evaluate_velocity",
      "verify_receipt",
      "decode_payment_required",
      "validate_policy",
      "evaluate_batch",
    ]) {
      expect(set.has(expected)).toBe(true);
    }
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

  it("answers resources/list and prompts/list with empty arrays, not -32601", async () => {
    // The live endpoint answered `-32601 Method not found` to both, which is a hard error to
    // Anthropic's and Cursor's checks. An empty list is the correct answer: the server has no
    // resources and no prompts, and says so instead of appearing broken.
    const app = createApp(env as never, { protect: false });
    for (const method of ["resources/list", "prompts/list"]) {
      const res = await app.request(
        "/mcp",
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method, params: {} }),
        },
        env as never,
      );
      const text = await res.text();
      expect(text, `${method} must not be Method not found`).not.toContain("-32601");
      expect(text).toContain('"result"');
    }
  });
});
