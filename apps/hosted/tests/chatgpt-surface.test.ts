import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { resetFreeTierBuckets } from "../src/free-tier.js";
import { curatedOverCapBody } from "../src/mcp.js";

/**
 * The ChatGPT-facing curve (#442): `/mcp` keeps all ten tools, `/mcp/chatgpt` is the same handlers
 * filtered to the read-only payment tools. These tests pin the two things a directory listing must
 * be able to rely on: the curated list has no writer, and the free tier's end says why instead of
 * looking like an outage.
 */

const env = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_PRICE: "$0.002",
  PAYSTAGE_NETWORK: "eip155:8453",
  FACILITATOR_URL: "https://x402.org/facilitator",
  FREE_TIER_ENABLED: "true",
};

type Tool = {
  name: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
};

type McpBody = {
  result?: { tools?: Tool[] };
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

/** MCP Streamable HTTP may answer JSON or an SSE frame; both are the same JSON object. */
function parseMcp(text: string): McpBody {
  const frames = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "));
  return JSON.parse(frames.length > 0 ? frames[frames.length - 1]!.slice("data: ".length) : text) as McpBody;
}

async function rpc(
  app: ReturnType<typeof createApp>,
  path: string,
  method: string,
  id: number,
  ip: string,
): Promise<{ status: number; headers: Headers; body: McpBody }> {
  const res = await app.request(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "cf-connecting-ip": ip,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }),
    },
    env as never,
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: parseMcp(text) };
}

async function toolsList(
  app: ReturnType<typeof createApp>,
  path: string,
  ip: string,
  id = 1,
): Promise<Tool[]> {
  const { status, body } = await rpc(app, path, "tools/list", id, ip);
  expect(status).toBe(200);
  return body.result?.tools ?? [];
}

describe("ChatGPT-facing curated MCP surface", () => {
  beforeEach(() => resetFreeTierBuckets());

  it("lists no tool whose own definition says readOnlyHint: false", async () => {
    const app = createApp(env as never, { protect: false });
    // Read the hints from the definitions the full endpoint serves; do not retype a name list,
    // which would keep passing while the curated surface drifted.
    const all = await toolsList(app, "/mcp", "203.0.113.10", 10);
    const curated = await toolsList(app, "/mcp/chatgpt", "203.0.113.11", 11);

    expect(curated.length).toBeGreaterThan(0);
    expect(curated.length).toBeLessThan(all.length);

    const definitions = new Map(all.map((tool) => [tool.name, tool]));
    for (const tool of curated) {
      const definition = definitions.get(tool.name);
      expect(definition, `${tool.name} is on /mcp/chatgpt but not on /mcp`).toBeDefined();
      expect(definition!.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBe(true);
    }

    // The assertion above is only meaningful if the full surface still contains something to
    // filter out. If every tool ever becomes read-only, this test should fail and be reconsidered.
    expect(all.some((tool) => tool.annotations?.readOnlyHint === false)).toBe(true);
  });

  it("names the cap and the paid path past the free allowance, not a bare 402/429", async () => {
    const app = createApp(
      { ...env, FREE_TIER_ENABLED: "true", FREE_TIER_DAILY_LIMIT: "2" } as never,
      { protect: false },
    );
    const ip = "203.0.113.12";

    const first = await rpc(app, "/mcp/chatgpt", "tools/list", 1, ip);
    const second = await rpc(app, "/mcp/chatgpt", "tools/list", 2, ip);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const capped = await rpc(app, "/mcp/chatgpt", "tools/list", 3, ip);
    expect(capped.status).toBe(429);
    expect(capped.headers.get("x-paystage-free-tier")).toBe("exhausted");
    expect(capped.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(capped.body.error?.data).toMatchObject({
      paystage_error: "free_tier_exhausted",
      daily_limit: 2,
      enforcement: "per-worker-instance",
      paid_path: "https://api.paystage.xyz/mcp",
    });
    const message = capped.body.error?.message ?? "";
    expect(message).toContain("2 free calls per day per Worker instance");
    expect(message).toContain("https://api.paystage.xyz/mcp");
    expect(message).toContain("not an outage");
  });

  it("the default cap body names 1,000 calls per day per Worker instance", () => {
    const body = curatedOverCapBody(1000, 3600) as {
      error: { message: string; data: Record<string, unknown> };
    };
    expect(body.error.message).toContain("1,000 free calls per day per Worker instance");
    expect(body.error.message).toContain("https://api.paystage.xyz/mcp");
    expect(body.error.data).toMatchObject({
      paystage_error: "free_tier_exhausted",
      daily_limit: 1000,
      paid_path: "https://api.paystage.xyz/mcp",
      price_usdc_per_call: "0.002",
    });
  });
});
