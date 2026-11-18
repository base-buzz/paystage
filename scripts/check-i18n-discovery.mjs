#!/usr/bin/env node
/**
 * Every agent-facing text file answers in Chinese too.
 *
 * An agent asked, in Chinese, to find x402 payment safety had nothing to match: `/llms.txt`, `/llms-full.txt`,
 * `llms-install.md` and the manifest were English-only, so the discovery surface answered in one language while the
 * site offered a Chinese page. That is the same failure as a language switch that changes nothing, one level down.
 *
 *   node scripts/check-i18n-discovery.mjs
 *
 * Exit 0 the required files carry a Chinese section · 1 one does not · 2 cannot read the tree.
 *
 * A section, not a word: at least 80 CJK characters, so a stray "中文" in a link list does not pass.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_CJK = 80;

const REQUIRED = [
  { file: "apps/console/src/app/llms.txt/route.ts", label: "/llms.txt" },
  { file: "apps/console/src/app/llms-full.txt/route.ts", label: "/llms-full.txt" },
  { file: "llms-install.md", label: "llms-install.md" },
  { file: "apps/console/src/lib/agent-manifest.ts", label: "agent manifest" },
];

/** These terms are what a Chinese-speaking agent or developer would search for. */
const TERMS = ["x402", "支付安全", "智能体", "不签名"];

const problems = [];
for (const { file, label } of REQUIRED) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    problems.push(`${label}: file not found (${file})`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjk < MIN_CJK) {
    problems.push(`${label}: ${cjk} CJK characters, needs at least ${MIN_CJK}`);
    continue;
  }
  const missing = TERMS.filter((term) => !text.includes(term));
  if (missing.length > 0) {
    problems.push(`${label}: Chinese section is missing the terms: ${missing.join(", ")}`);
  }
}

if (problems.length === 0) {
  console.log(`i18n-discovery: ${REQUIRED.length} agent-facing file(s) answer in Chinese`);
  process.exit(0);
}
console.error("i18n-discovery: a Chinese-speaking agent would not find us in these files:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
