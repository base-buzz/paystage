#!/usr/bin/env node
/**
 * The one part of the starter that needs no wallet: it proves the endpoint answers, lists its tools, and returns a
 * verdict. Every client below reaches the same thing — this script is what CI runs so the instructions cannot rot.
 *
 *   node starter/check.mjs
 *
 * Exit 0 on nine tools and a verdict · 1 otherwise.
 */
const MCP = "https://api.paystage.xyz/mcp";
const API = "https://api.paystage.xyz";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYEE = "0xc64a71e150cd21ebc4b12695850bed6b067743bc";

async function mcpSession() {
  const init = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-paystage-source": "test" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "paystage-starter", version: "1.0.0" } },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!init.ok) throw new Error(`initialize HTTP ${init.status}`);
  const session = init.headers.get("mcp-session-id") ?? "";
  await init.text();

  const list = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await list.text();
  const payload = raw.includes("data: ") ? raw.slice(raw.indexOf("data: ") + 6) : raw;
  const tools = (JSON.parse(payload.split("\n")[0]).result?.tools ?? []).map((t) => t.name);
  return tools;
}

async function oneVerdict() {
  const res = await fetch(`${API}/v1/evaluate_mcp_payment`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystage-source": "test" },
    body: JSON.stringify({
      payment_required: {
        x402Version: 2,
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: "12500000", asset: USDC, payTo: PAYEE, maxTimeoutSeconds: 300 }],
      },
      policy: {
        version: 1,
        max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
        allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
        allowed_networks: ["eip155:8453"],
        allowed_pay_to: [PAYEE],
        max_timeout_seconds: 300,
        unknown_payee: "deny",
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  return { status: res.status, decision: body.decision, reason: body.reasons?.[0] };
}

const problems = [];
let tools = [];
try {
  tools = await mcpSession();
  console.log(`mcp:      ${tools.length} tools (${tools.slice(0, 3).join(", ")}…)`);
  // Fourth place a tool count was typed beside the thing it counts. The floor, not an equality: this starter must work
  // against a published package, and a package that adds a tool should not fail a reader's first run.
  if (tools.length < 9) problems.push(`expected at least 9 tools, got ${tools.length}`);
} catch (error) {
  problems.push(`mcp: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const verdict = await oneVerdict();
  console.log(`verdict:  ${verdict.decision} — ${verdict.reason ?? "no reason"}`);
  if (verdict.decision !== "do_not_pay") problems.push(`expected do_not_pay for a 12.5 USDC ask against a 0.05 cap, got ${verdict.decision}`);
} catch (error) {
  problems.push(`verdict: ${error instanceof Error ? error.message : String(error)}`);
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  process.exit(1);
}
console.log("starter: endpoint answers, ten tools, one real verdict — no wallet needed for this much");
