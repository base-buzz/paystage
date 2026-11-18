#!/usr/bin/env node
/**
 * An agent has to be able to answer "what does this do, and what do I call" from the files we publish.
 *
 * Discovery is not a registry rank — that turned out not to be ours to influence (see backlog #151). What is ours: the
 * text an agent reads after it finds us. Three surfaces matter and all three are checkable:
 *
 *  - `/llms.txt` and `/llms-full.txt` carry a **question → call** table, so an agent maps its task to a tool without
 *    reading prose;
 *  - the landing page carries **JSON-LD**, because an agent that arrives from a search result gets HTML, not llms.txt;
 *  - both are generated from the same manifest, so they cannot disagree about the tool count.
 *
 *   node scripts/check-agent-discovery.mjs
 *
 * Exit 0 all three present · 1 one is missing · 2 cannot read.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const surfaces = [
  { file: "apps/console/src/app/llms.txt/route.ts", label: "/llms.txt", needs: ["Questions an agent asks", "evaluate_mcp_payment"] },
  { file: "apps/console/src/app/llms-full.txt/route.ts", label: "/llms-full.txt", needs: ["Questions an agent asks", "request_testnet_funds"] },
  { file: "apps/console/src/app/page.tsx", label: "landing page", needs: ["application/ld+json", "SoftwareApplication", "FAQPage"] },
];

for (const { file, label, needs } of surfaces) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    problems.push(`${label}: file not found (${file})`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  for (const needle of needs) {
    if (!text.includes(needle)) problems.push(`${label}: missing ${needle}`);
  }
}

/** The question table must name calls that exist — a table of dead tool names is worse than no table. */
const toolsSource = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
const names = [...(/export const TOOL_NAMES = \[([\s\S]*?)\] as const/.exec(toolsSource)?.[1] ?? "").matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
const table = readFileSync(join(ROOT, "apps/console/src/app/llms-full.txt/route.ts"), "utf8");
for (const match of table.matchAll(/\|\s*"[^"]+"\s*\|\s*\\`([a-z0-9_]+)\(/g)) {
  if (!names.includes(match[1])) problems.push(`the question table names ${match[1]}, which is not a registered tool`);
}

if (problems.length === 0) {
  console.log(`agent-discovery: question table, JSON-LD and ${names.length} tool names all agree`);
  process.exit(0);
}
console.error("agent-discovery: an agent could not map its task to a call:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
