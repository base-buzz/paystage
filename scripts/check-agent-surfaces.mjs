#!/usr/bin/env node
/**
 * The machine surfaces must name every tool the server registers.
 *
 * This exists because they did not: `PAYSTAGE_MANIFEST` listed five tools while `TOOL_NAMES` listed ten, and because every
 * static surface renders from the manifest, `/llms.txt`, `/llms-full.txt` and `/.well-known/paystage.json` all advertised
 * half the product. The conformance check compared the manifest to itself and stayed green, which is the shape of every bug
 * this project has had to fix twice.
 *
 *   node scripts/check-agent-surfaces.mjs            # check the built routes in the repo (no network)
 *   node scripts/check-agent-surfaces.mjs --live     # check what is actually served
 *
 * Exit 0 every surface names every tool · 10 a tool is missing from a surface · 11 a surface cannot be read.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");

const serverSource = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
const block = /export const TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(serverSource)?.[1] ?? "";
const tools = [...block.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
if (tools.length === 0) {
  console.error("agent-surfaces: cannot read TOOL_NAMES from packages/mcp/src/tools.ts");
  process.exit(11);
}

/**
 * The repo source is NOT a valid stand-in for the served output.
 *
 * `llms.txt` and `llms-full.txt` interpolate their tool lines from the manifest, so the route files never contain the tool
 * names — a source-mode check reported two surfaces incomplete on a site that was complete. Only the manifest is checked in
 * source mode (it is the data), and everything is checked in `--live` mode, which is what CI runs.
 */
const SURFACES = [
  { name: "agent-manifest", file: "apps/console/src/lib/agent-manifest.ts", live: "https://paystage.xyz/.well-known/paystage.json", sourceIsData: true },
  { name: "llms-full", file: "apps/console/src/app/llms-full.txt/route.ts", live: "https://paystage.xyz/llms-full.txt" },
  { name: "llms", file: "apps/console/src/app/llms.txt/route.ts", live: "https://paystage.xyz/llms.txt" },
];

let failures = 0;
for (const surface of SURFACES) {
  if (!LIVE && !surface.sourceIsData) {
    console.log(`  skip ${surface.name}: generated at request time — checked in --live mode`);
    continue;
  }
  let text;
  try {
    text = LIVE
      ? await (await fetch(surface.live, { signal: AbortSignal.timeout(20_000) })).text()
      : readFileSync(join(ROOT, surface.file), "utf8");
  } catch (error) {
    console.error(`  FAIL ${surface.name}: unreadable — ${String(error).slice(0, 60)}`);
    failures += 1;
    continue;
  }
  const missing = tools.filter((t) => !text.includes(t));
  if (missing.length) {
    console.error(`  FAIL ${surface.name}: missing ${missing.join(", ")}`);
    failures += 1;
  } else {
    console.log(`  ok   ${surface.name} names all ${tools.length} tools`);
  }
}

console.log(failures === 0 ? `agent-surfaces: ${tools.length} tools, all surfaces complete${LIVE ? " (live)" : ""}` : `agent-surfaces: ${failures} surface(s) incomplete`);
process.exit(failures === 0 ? 0 : 10);
