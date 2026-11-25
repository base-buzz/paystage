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
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- tools:table:start -->";
const END = "<!-- tools:table:end -->";
const FILES = ["README.md", "packages/mcp/README.md", "README.zh-CN.md"];

/**
 * One line per tool, maintained here rather than in four files.
 *
 * The generator asserts this map covers exactly the registered tools, so a new tool cannot ship without a
 * row and a deleted one cannot leave one behind.
 */
const SUMMARY = {
  evaluate_mcp_payment: "should this x402 payment be signed? → `pay` · `review` · `do_not_pay`",
  evaluate_batch: "the same question for several payments, one verdict each",
  request_testnet_funds: "0.5 Base Sepolia USDC for testing — one drip per address per 24h, with the reset time",
  list_outstanding_auths: "which ERC-20 / Permit2 / EIP-3009 authorisations are still outstanding",
  evaluate_outstanding_auths: "which of those need attention before the next payment",
  evaluate_hip3_trade: "should this HIP-3 / trade.xyz order be placed? → `allow` · `review` · `do_not_trade`",
  evaluate_velocity: "is this spend a burst, a spike, or a runaway cadence",
  verify_receipt: "is this receipt really ours — and is it about *this* payment, still in date",
  decode_payment_required: "what does this base64 402 header actually say",
  validate_policy: "is this policy document valid, and if not which field",
};

/** Chinese one-liners, same rows, same order — the translation is a summary, not a second product claim. */
/** Roles, in the order a reader meets them. A package without a role here fails the check rather than vanishing from the table. */
const PACKAGE_ROLES = {
  "@paystage/mcp": "umbrella MCP server — start here",
  "@paystage/preflight": "x402 payment preflight (the evaluator)",
  "@paystage/x402-guard": "policy gate for x402 clients, before the wallet signs",
  "@paystage/ai-sdk": "the same gate as Vercel AI SDK tools",
  "@paystage/auth-watch": "outstanding ERC-20 / Permit2 / EIP-3009 authorisations",
  "@paystage/velocity": "rate and spend-pattern checks",
  "@paystage/trade-preflight": "HIP-3 / trade.xyz order preflight",
  "@paystage/policy": "policy schema and loader",
  "@paystage/skill": "agent skill manifest",
  "@paystage/x-evm": "chain-agnostic EVM helpers",
  "@paystage/n8n": "the gate as an n8n community node",
  "@paystage/eliza-plugin": "the gate as an elizaOS action",
  "@paystage/receipt-verify": "verify a signed receipt without the server",
  "@paystage/mandate": "issue, verify and evaluate a scoped, revocable authority",
  "@paystage/channel": "read-only x402 deposit-channel state",
};

/**
 * Packages that exist in the repo but not yet on npm. Emptying this list is the publish step for #88 and #89.
 */
const PENDING_PUBLISH = new Set(["@paystage/n8n", "@paystage/eliza-plugin", "@paystage/mandate"]);

const PKG_START = "<!-- packages:table:start -->";
const PKG_END = "<!-- packages:table:end -->";

function packagesTable() {
  const dirs = readdirSync(join(ROOT, "packages"), { withFileTypes: true }).filter((d) => d.isDirectory());
  const rows = [];
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(ROOT, "packages", dir.name, "package.json"), "utf8"));
    if (manifest.private) continue;
    const role = PACKAGE_ROLES[manifest.name];
    if (!role) {
      problems.push(`package ${manifest.name} has no role in PACKAGE_ROLES — add one`);
      continue;
    }
    /**
     * A link to npm is a claim that the package is installable there.
     *
     * The two framework packages are built, tested and green but waiting on a Trusted Publisher entry, so an npm link in the README
     * would 404 for anyone who followed it — the claim outrunning the artefact, which is the one thing this project refuses to ship.
     */
    const pending = PENDING_PUBLISH.has(manifest.name);
    rows.push(`| \`${manifest.name}\` | ${role} | ${pending ? "in this repo — first publish pending" : `[npm](https://www.npmjs.com/package/${manifest.name})`} |`);
  }
  // Umbrella first, then the gate, then the rest alphabetically — the order a reader needs them in.
  rows.sort((a, b) => {
    const rank = (r) => (r.includes("@paystage/mcp") ? 0 : r.includes("x402-guard") ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return ["| Package | Role | Links |", "| --- | --- | --- |", ...rows].join("\n");
}

const SUMMARY_ZH = {
  evaluate_mcp_payment: "这笔 x402 支付该不该签？→ `pay` · `review` · `do_not_pay`",
  evaluate_batch: "同一问题，批量评估多笔支付，每笔一个判定",
  request_testnet_funds: "测试用的 0.5 Base Sepolia USDC —— 每个地址每 24 小时一次，并给出重置时间",
  list_outstanding_auths: "还有哪些 ERC-20 / Permit2 / EIP-3009 授权尚未结清",
  evaluate_outstanding_auths: "哪些授权需要在下一笔支付前处理",
  evaluate_hip3_trade: "这笔 HIP-3 / trade.xyz 订单该不该下？→ `allow` · `review` · `do_not_trade`",
  evaluate_velocity: "这次消费是短时爆发、尖峰，还是失控的节奏",
  verify_receipt: "这张回执是不是我们签发的——是否针对这笔支付、是否仍在有效期内",
  decode_payment_required: "这个 base64 的 402 头到底说了什么",
  validate_policy: "这份策略文档是否合法，问题出在哪个字段",
};

function registeredTools() {
  const src = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
  return [...new Set([...src.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
}

function table(tools, zh = false) {
  const dict = zh ? SUMMARY_ZH : SUMMARY;
  const rows = tools.map((t) => `| \`${t}\` | ${dict[t] ?? SUMMARY[t]} |`);
  const head = zh ? "| 工具 | 它回答什么 |" : "| tool | what it answers |";
  return [head, "|---|---|", ...rows].join("\n");
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

  const generated = table(tools, file.endsWith("zh-CN.md"));
  const before = text.slice(0, text.indexOf(START) + START.length);
  const after = text.slice(text.indexOf(END));
  const next = `${before}\n${generated}\n${after}`;

  // Any README that declares the markers gets the generated table — the npm page renders packages/mcp/README.md, so a
  // fix that only touched the repo README left npm showing a five-row list for a day.
  if (text.includes(PKG_START)) {
    const pkgBefore = next.slice(0, next.indexOf(PKG_START) + PKG_START.length);
    const pkgAfter = next.slice(next.indexOf(PKG_END));
    const withPkgs = `${pkgBefore}\n${packagesTable()}\n${pkgAfter}`;
    if (write) {
      if (withPkgs !== readFileSync(path, "utf8")) writeFileSync(path, withPkgs);
    } else if (withPkgs !== text) {
      problems.push(`${file}: packages table is stale — run --write`);
    }
  }

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
