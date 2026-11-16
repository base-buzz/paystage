#!/usr/bin/env node
/**
 * Generate the tool tables from the code, so "documented" cannot drift from "shipped".
 *
 * Three different failures this week had one shape: a table written by hand, describing a product from an
 * older release. The repo README listed five of nine, the npm README four of nine, and both stayed green
 * because a check asked "does the name appear anywhere in this file".
 *
 * The fix is not another check — it is not writing the table by hand. This script owns the table:
 *
 *   node scripts/sync-tool-docs.mjs --write    # rewrite every marked table from tools.ts
 *   node scripts/sync-tool-docs.mjs --check    # exit 1 if any table is stale (runs on pre-push)
 *
 * A file opts in with markers:
 *
 *   <!-- tools:table:start -->
 *   ...generated rows...
 *   <!-- tools:table:end -->
 *
 * Anything tool-shaped *outside* a marked block is reported too: that is how a second, stale table survived.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- tools:table:start -->";
const END = "<!-- tools:table:end -->";
const FILES = ["README.md", "packages/mcp/README.md"];

/**
 * One line per tool, maintained here rather than in four files.
 *
 * The generator asserts this map covers exactly the registered tools, so a new tool cannot ship without a
 * row and a deleted one cannot leave one behind.
 */
const SUMMARY = {
  evaluate_mcp_payment: "should this x402 payment be signed? → `pay` · `review` · `do_not_pay`",
  evaluate_batch: "the same question for several payments, one verdict each",
  list_outstanding_auths: "which ERC-20 / Permit2 / EIP-3009 authorisations are still outstanding",
  evaluate_outstanding_auths: "which of those need attention before the next payment",
  evaluate_hip3_trade: "should this HIP-3 / trade.xyz order be placed? → `allow` · `review` · `do_not_trade`",
  evaluate_velocity: "is this spend a burst, a spike, or a runaway cadence",
  verify_receipt: "is this receipt really ours — and is it about *this* payment, still in date",
  decode_payment_required: "what does this base64 402 header actually say",
  validate_policy: "is this policy document valid, and if not which field",
};

function registeredTools() {
  const src = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
  return [...new Set([...src.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
}

function table(tools) {
  const rows = tools.map((t) => `| \`${t}\` | ${SUMMARY[t]} |`);
  return ["| tool | what it answers |", "|---|---|", ...rows].join("\n");
}

const write = process.argv.includes("--write");
const tools = registeredTools();
const problems = [];

const undocumented = tools.filter((t) => !SUMMARY[t]);
const stale = Object.keys(SUMMARY).filter((t) => !tools.includes(t));
if (undocumented.length) problems.push(`no table row for: ${undocumented.join(", ")} — add it to SUMMARY in this script`);
if (stale.length) problems.push(`row for a tool that no longer exists: ${stale.join(", ")}`);

const generated = table(tools);

for (const file of FILES) {
  const path = join(ROOT, file);
  const text = readFileSync(path, "utf8");

  if (!text.includes(START)) {
    // Mark it up on first run so the file becomes generated rather than hand-written.
    problems.push(`${file} has no ${START} marker — run --write to adopt it`);
    continue;
  }

  const before = text.slice(0, text.indexOf(START) + START.length);
  const after = text.slice(text.indexOf(END));
  const next = `${before}\n${generated}\n${after}`;

  if (write) {
    if (next !== text) writeFileSync(path, next);
  } else if (next !== text) {
    problems.push(`${file}: table is stale — run \`node scripts/sync-tool-docs.mjs --write\``);
  }

  // A tool row outside a marked block is a second table waiting to rot. This is the rule that would have
  // caught the five-row table that sat above the nine-row one.
  const outside = text
    .replace(new RegExp(`${START}[\\s\\S]*?${END}`, "g"), "")
    .split("\n")
    .filter((line) => /^\|\s*`[a-z0-9_]+`\s*\|/.test(line) && tools.some((t) => line.includes(t)));
  if (outside.length > 0) {
    problems.push(`${file}: ${outside.length} tool row(s) outside the generated table — delete them or move them inside`);
  }
}

if (write) {
  console.log(`tool docs: wrote ${tools.length} rows into ${FILES.length} files`);
  process.exit(problems.length === 0 ? 0 : 1);
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  DRIFT ${p}`);
  console.log("tool docs: stale");
  process.exit(1);
}
console.log(`tool docs: ${tools.length} tools, all tables generated and current`);
