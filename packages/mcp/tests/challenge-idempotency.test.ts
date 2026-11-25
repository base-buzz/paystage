import { describe, expect, it } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";

/**
 * #444 wiring: the MCP tool, not just the evaluator, must recognise a retried challenge.
 *
 * `createServer()` owns a per-process store; this calls the same handler twice with the same
 * challenge so the second call is a genuine repeat rather than a second fresh `pay`.
 */

async function callTool(
  name: string,
  args: unknown,
): Promise<{ json?: Record<string, unknown>; text?: string; isError?: boolean }> {
  const handler = createMcpHandler(() => createServer());
  const res = await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await res.text();
  const frame = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data: "));
  if (!frame) throw new Error(`no SSE frame: ${text.slice(0, 200)}`);
  const body = JSON.parse(frame.slice(6)) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const payload = body.result?.content?.[0]?.text ?? "";
  try {
    return { isError: Boolean(body.result?.isError), json: JSON.parse(payload) as Record<string, unknown> };
  } catch {
    return { isError: Boolean(body.result?.isError), text: payload };
  }
}

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:84532" }],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

const challenge = {
  x402Version: 2,
  resource: { url: "https://seller.example/idempotent" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      asset: USDC,
      amount: "200000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

describe("evaluate_mcp_payment challenge idempotency (#444)", () => {
  it("returns the original verdict with repeated: true and the original as_of", async () => {
    const first = await callTool("evaluate_mcp_payment", {
      policy,
      payment_required: challenge,
    });
    expect(first.json?.decision).toBe("pay");
    expect(first.json?.challenge_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.json?.repeat_check).toEqual({ checked: true, reason: "first_sight" });
    expect(first.json?.repeated).toBeUndefined();

    const retry = await callTool("evaluate_mcp_payment", {
      policy,
      payment_required: challenge,
    });
    expect(retry.json?.decision).toBe(first.json?.decision);
    expect(retry.json?.repeated).toBe(true);
    expect(Number.isFinite(Date.parse(retry.json?.as_of as string))).toBe(true);
    expect(retry.json?.challenge_digest).toBe(first.json?.challenge_digest);
    expect(retry.json?.repeat_check).toEqual({ checked: true, reason: "repeat" });
  });
});
