#!/usr/bin/env node
/**
 * The fail-closed sentence must be in the docs a reviewer reads and in every tool an agent sees.
 *
 *   node scripts/check-fail-closed.mjs
 *
 * Exit 0 every surface carries it · 1 one is missing · 2 a file could not be read.
 *
 * `LIMITS.md` §8b states the posture — "Do not invent authority; fail closed when policy, identity, cost or evidence
 * is missing." — and #305 asked for the same line in the MCP tool descriptions. It was in one tool of ten, which is
 * worse than none: a reader who checks two tools concludes the behaviour is per-tool rather than the system's.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIMITS = join(ROOT, "LIMITS.md");
const TOOLS = join(ROOT, "packages/mcp/src/tools.ts");

for (const file of [LIMITS, TOOLS]) {
  if (!existsSync(file)) {
    console.error(`fail-closed: ${file} not found`);
    process.exit(2);
  }
}

let limits;
let tools;
try {
  limits = readFileSync(LIMITS, "utf8");
  tools = readFileSync(TOOLS, "utf8");
} catch (error) {
  console.error(`fail-closed: cannot read a source — ${error.code ?? error.message}`);
  process.exit(2);
}

const problems = [];

if (!/do not invent authority; fail closed when policy, identity, cost or evidence is missing/i.test(limits)) {
  problems.push("LIMITS.md no longer states the sentence a reviewer quotes");
}

/**
 * Every tool, not a sample. The descriptions are the contract an agent reads before it decides whether to call us, so a
 * tool without the line is a tool whose refusal is indistinguishable from a bug.
 */
const blocks = [...tools.matchAll(/registerTool\(\s*"([a-z0-9_]+)",\s*\{\s*description:\s*"([\s\S]*?)",\s*annotations:/g)];
if (blocks.length === 0) {
  problems.push("no tool descriptions parsed from packages/mcp/src/tools.ts — the shape changed");
}

for (const [, name, description] of blocks) {
  const mentions = /do not invent authority/i.test(description);
  if (!mentions) {
    problems.push(`${name} does not state the fail-closed line`);
  } else if (!/fails?[- ]?closed/i.test(description)) {
    problems.push(`${name} mentions authority but never says "fail closed"`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`fail-closed: ${p}`);
  console.error(`fail-closed: ${problems.length} problem(s) — the posture must read the same everywhere`);
  process.exit(1);
}

console.log(`fail-closed: LIMITS.md and ${blocks.length} tool description(s) carry the same posture`);
process.exit(0);
