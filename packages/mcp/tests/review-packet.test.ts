import { describe, it, expect } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";

/** Call a tool over the same HTTP handler the hosted Worker uses, so the payload is what an agent receives. */
async function callTool(name: string, args: unknown): Promise<{ json?: Record<string, unknown>; text?: string; isError?: boolean }> {
  const handler = createMcpHandler(() => createServer());
  const res = await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const text = await res.text();
  const frame = text.split("\n").map((line) => line.trim()).find((line) => line.startsWith("data: "));
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

const policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", network: "eip155:84532" }],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 300,
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "deny" as const,
};

const challenge = (amount: string) => ({
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount,
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
    },
  ],
});

describe("evaluate_mcp_payment review packet", () => {
  it("includes the packet for a review verdict", async () => {
    const out = await callTool("evaluate_mcp_payment", {
      policy,
      payment_required: challenge("600000"),
    });

    expect(out.json?.decision).toBe("review");
    const packet = out.json?.packet as Record<string, unknown> | undefined;
    expect(packet).toBeDefined();
    expect(packet?.schema).toBe("paystage.review-packet.v1");
    expect(packet?.amount).toBeDefined();
    expect(packet?.payee).toBeDefined();
    expect(packet?.rule).toEqual(expect.any(String));
    expect(packet?.checked).toEqual(expect.any(Array));
    expect(packet?.not_checked).toEqual(expect.any(Array));
    expect(packet?.decision).toBeDefined();
  });

  it("omits the packet for a pay verdict", async () => {
    const out = await callTool("evaluate_mcp_payment", {
      policy,
      payment_required: challenge("1000"),
    });

    expect(out.json?.decision).toBe("pay");
    expect(out.json?.packet).toBeUndefined();
  });

  it("omits the packet for a do_not_pay verdict", async () => {
    const out = await callTool("evaluate_mcp_payment", {
      policy,
      payment_required: challenge("2000000"),
    });

    expect(out.json?.decision).toBe("do_not_pay");
    expect(out.json?.packet).toBeUndefined();
  });

  it("tells the caller in the tool description that review carries a packet", async () => {
    const handler = createMcpHandler(() => createServer());
    const res = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    const text = await res.text();
    const frame = text.split("\n").map((line) => line.trim()).find((line) => line.startsWith("data: "));
    if (!frame) throw new Error(`no SSE frame: ${text.slice(0, 200)}`);
    const body = JSON.parse(frame.slice(6)) as {
      result?: { tools?: Array<{ name: string; description?: string }> };
    };
    const description = body.result?.tools?.find((tool) => tool.name === "evaluate_mcp_payment")?.description ?? "";
    expect(description).toMatch(/review/i);
    expect(description).toMatch(/packet/i);
  });
});
