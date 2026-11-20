import { describe, it, expect } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";

/**
 * The three tools that had no behavioural test (#324): they were named in the tool list and exercised by the protocol tests, and nothing asserted what they actually decide.
 *
 * All three are parsers or an aggregator, which is the worst place for that gap: a decoder that rounds an amount, a validator that accepts a contradiction, and a batch that returns
 * `pay` for a batch containing a refusal are each a silent wrong answer rather than a crash.
 */
async function call(name: string, args: unknown): Promise<unknown> {
  const handler = createMcpHandler(() => createServer());
  const res = await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const text = await res.text();
  const frame = text.split("\n").map((l) => l.trim()).find((l) => l.startsWith("data: "));
  if (!frame) throw new Error(`no SSE frame: ${text.slice(0, 200)}`);
  const body = JSON.parse(frame.slice(6)) as { result?: { content?: Array<{ text?: string }> ; isError?: boolean } };
  const payload = body.result?.content?.[0]?.text ?? "";
  try {
    return { isError: Boolean(body.result?.isError), json: JSON.parse(payload) as unknown };
  } catch {
    return { isError: Boolean(body.result?.isError), text: payload };
  }
}

const policy = {
  version: 1,
  max_amount: { value: "5", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 600,
  unknown_payee: "deny" as const,
};

const challenge = (amount: string, asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") => ({
  x402Version: 2,
  resource: { url: "https://seller.example/paid" },
  accepts: [
    { scheme: "exact", network: "eip155:8453", asset, amount, payTo: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", maxTimeoutSeconds: 300 },
  ],
});

describe("decode_payment_required", () => {
  it("rounds nothing: the atomic amount and asset come back exactly as encoded", async () => {
    // 0.000001 USDC is 1 atomic unit. A decoder that treats decimals as USDC units returns 0.000001 and looks right; one that divides twice returns 0.000000001 and looks plausible.
    const encoded = Buffer.from(JSON.stringify(challenge("1"))).toString("base64");
    const out = (await call("decode_payment_required", { header: encoded })) as { json?: { accepts?: Array<{ amount?: string; asset?: string }> } };
    expect(out.json?.accepts?.[0]?.amount).toBe("1");
    expect(out.json?.accepts?.[0]?.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  it("names the failure instead of returning an empty challenge", async () => {
    const notBase64 = (await call("decode_payment_required", { header: "!!!" })) as { isError?: boolean; text?: string };
    expect(notBase64.isError || /base64/i.test(notBase64.text ?? "")).toBe(true);
    const notJson = (await call("decode_payment_required", { header: Buffer.from("not json").toString("base64") })) as { isError?: boolean };
    expect(notJson.isError).toBe(true);
  });
});

describe("validate_policy", () => {
  it("accepts a usable policy", async () => {
    const out = (await call("validate_policy", { policy })) as { json?: { valid?: boolean } };
    expect(out.json?.valid).toBe(true);
  });

  it("rejects a policy whose decimals disagree with its asset, and names the path", async () => {
    /**
     * The contradiction that is real. An earlier version of this test used "payee allow-listed but network not allowed" and the validator accepted it — correctly, because an EVM address
     * exists on every chain, so that policy is merely narrow, not invalid. A decimals mismatch is different: 6-decimal USDC with max_amount decimals 18 turns every limit into a number
     * nobody computed.
     */
    const contradictory = { ...policy, max_amount: { ...policy.max_amount, decimals: 18 } };
    const out = (await call("validate_policy", { policy: contradictory })) as { json?: { valid?: boolean; error?: string } };
    expect(out.json?.valid).toBe(false);
    expect(String(out.json?.error ?? "")).toMatch(/decimals|asset/i);
  });

  it("rejects an empty allow list instead of treating it as 'anything'", async () => {
    const out = (await call("validate_policy", { policy: { ...policy, allowed_pay_to: [] } })) as { json?: { valid?: boolean } };
    expect(out.json?.valid).toBe(false);
  });

  it("rejects an unknown enum rather than defaulting it", async () => {
    const out = (await call("validate_policy", { policy: { ...policy, unknown_payee: "maybe" } })) as { json?: { valid?: boolean } };
    expect(out.json?.valid).toBe(false);
  });
});

describe("evaluate_batch", () => {
  it("cannot return pay when one member is refused", async () => {
    const out = (await call("evaluate_batch", {
      policy,
      payments: [challenge("1000"), challenge("999999999")],
    })) as { json?: { results?: Array<{ decision?: string }> } };
    const decisions = (out.json?.results ?? []).map((r) => r.decision);
    expect(decisions).toEqual(["pay", "do_not_pay"]);
    // The aggregate must carry the refusal, not smooth it: a caller that reads only the first entry must still be able to see this.
    expect(decisions).toContain("do_not_pay");
  });

  it("keeps input order, so the first refusal is the first thing an agent sees", async () => {
    const out = (await call("evaluate_batch", {
      policy,
      payments: [challenge("999999999"), challenge("1000")],
    })) as { json?: { results?: Array<{ decision?: string }> } };
    expect((out.json?.results ?? []).map((r) => r.decision)).toEqual(["do_not_pay", "pay"]);
  });
});
