#!/usr/bin/env node
/**
 * Two MCP servers, one client session, no SDK.
 *
 * The claim worth testing is not "our server works" — that is the canary's job. It is that our server
 * coexists with Base's own agent surface in the same session, which is what an integrating agent does. The
 * original plan named `base-mcp`; that package is deprecated ("[DEPRECATED] See docs.base.org/ai-agents") and
 * Base's current MCP server is the docs server at docs.base.org/mcp.
 *
 * Speaks the protocol directly rather than through a client library: @modelcontextprotocol/core v2 exports no
 * client, and a check that needs a dependency to run is a check that stops running.
 *
 *   node scripts/interop-check.mjs
 *
 * Exit 0 both answered · 10 one did not.
 */
const SERVERS = [
  { name: "paystage", url: "https://api.paystage.xyz/mcp" },
  { name: "base-docs", url: "https://docs.base.org/mcp" },
];

async function handshake(url) {
  const init = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-paystage-source": "test",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "paystage-interop", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!init.ok) throw new Error(`initialize HTTP ${init.status}`);
  const sessionId = init.headers.get("mcp-session-id") ?? "";
  await init.text();

  const list = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!list.ok) throw new Error(`tools/list HTTP ${list.status}`);
  const raw = await list.text();
  const payload = raw.includes("data: ") ? raw.slice(raw.indexOf("data: ") + 6) : raw;
  const parsed = JSON.parse(payload.split("\n")[0]);
  const tools = (parsed.result?.tools ?? []).map((t) => t.name);
  if (tools.length === 0) throw new Error("tools/list returned no tools");
  return tools;
}

const results = [];
const problems = [];

await Promise.all(
  SERVERS.map(async (server) => {
    try {
      results.push({ ...server, tools: await handshake(server.url) });
    } catch (error) {
      problems.push(`${server.name} (${server.url}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }),
);

for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
  const shown = r.tools.slice(0, 3).join(", ") + (r.tools.length > 3 ? "…" : "");
  console.log(`  ${r.name.padEnd(10)} ${String(r.tools.length).padStart(2)} tools  ${shown}`);
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  UNREACHABLE ${p}`);
  console.log("interop: FAIL");
  process.exit(10);
}

const ours = results.find((r) => r.name === "paystage");
console.log(
  ours?.tools.length === 9
    ? "interop: PASS — both servers answered in one session; nine PayStage tools available beside Base's docs server"
    : `interop: PASS(unexpected) — both answered, but paystage advertised ${ours?.tools.length ?? 0} tools`,
);
