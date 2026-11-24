#!/usr/bin/env node
/**
 * Does the deployed /mcp endpoint serve the ten tools the repo declares?
 *
 * `check-agent-tool-parity` compares the repo's tool list against the site's copy. Neither says anything about the endpoint an agent actually connects to — and the
 * failure mode is quiet: a tool missing from the deployed server still appears in every document.
 *
 *   node scripts/check-mcp-live.mjs
 *
 * Exit 0 the endpoint lists exactly the declared tools · 10 it does not · 11 the endpoint could not be read.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
const declared = [...(/export const TOOL_NAMES = \[([\s\S]*?)\];/.exec(source)?.[1] ?? "").matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
if (declared.length === 0) {
  console.error("mcp-live: cannot read TOOL_NAMES — the parse is wrong, not the server");
  process.exit(11);
}

/** Streamable HTTP answers as server-sent events; one `data:` line per message. */
const rpc = async (payload) => {
  const res = await fetch("https://api.paystage.xyz/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  if (!line) throw new Error(`no data line (HTTP ${res.status})`);
  return JSON.parse(line.slice(6));
};

try {
  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "check-mcp-live", version: "1" } },
  });
  if (!init?.result?.serverInfo) throw new Error("initialize returned no serverInfo");

  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const served = (list?.result?.tools ?? []).map((t) => t.name);

  const missing = declared.filter((t) => !served.includes(t));
  const extra = served.filter((t) => !declared.includes(t));
  if (missing.length || extra.length) {
    console.error(`mcp-live: deployed endpoint differs — missing ${missing.join(", ") || "none"}${extra.length ? `; extra ${extra.join(", ")}` : ""}`);
    process.exit(10);
  }
  console.log(`mcp-live: ${init.result.serverInfo.name} serves ${served.length} tool(s), matching TOOL_NAMES`);
} catch (error) {
  console.error(`mcp-live: could not read /mcp — ${String(error).slice(0, 90)}`);
  process.exit(11);
}
