#!/usr/bin/env node
/**
 * Does the published MCP server actually start and answer, from a cold npx?
 *
 * This is the check behind "the install instructions work". It spawns exactly what the
 * README tells a stranger to run, sends a real JSON-RPC `initialize` and `tools/list` over
 * stdio, and reports what comes back. Anything less is trusting a README.
 *
 *   node scripts/mcp-handshake.mjs
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const CMD = process.platform === "win32" ? "npx.cmd" : "npx";
// Two bins are declared, so npx cannot infer which one to run: it needs -p plus the bin
// name. `npx -y @paystage/mcp` fails with "could not determine executable to run".
const ARGS = ["-y", "-p", "@paystage/mcp", "paystage-mcp"];

// Run outside the repo. Inside it, npm resolves the workspace link and tests our local
// dist, not the published package a stranger would actually get.
const child = spawn(CMD, ARGS, { stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir() });

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => (stdout += d.toString()));
child.stderr.on("data", (d) => (stderr += d.toString()));

const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);

setTimeout(() => {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "handshake", version: "1.0.0" } },
  });
}, 1500);

setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 2500);

setTimeout(() => {
  child.kill("SIGTERM");

  const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      /* partial line */
    }
  }

  const init = parsed.find((m) => m.id === 1);
  const tools = parsed.find((m) => m.id === 2);

  const ok = Boolean(init?.result?.serverInfo) && Array.isArray(tools?.result?.tools);

  console.log(
    JSON.stringify(
      {
        ok,
        server: init?.result?.serverInfo ?? null,
        protocolVersion: init?.result?.protocolVersion ?? null,
        toolCount: tools?.result?.tools?.length ?? 0,
        tools: (tools?.result?.tools ?? []).map((t) => t.name),
        stderr: stderr.trim().slice(0, 400) || null,
      },
      null,
      2,
    ),
  );

  process.exit(ok ? 0 : 1);
}, 6000);
