#!/usr/bin/env node
/**
 * The demo speaks budgets, not crypto (#454).
 *
 * A VouchGuard screen is shown to an SME, not to a protocol engineer. The words are **budget, top up, balance, refusal,
 * limit**; the crypto nouns stay out of anything a person reads. This is a vocabulary rule, so the check is a grep —
 * and a grep with an allowlist, because two words in the ban are legitimate here:
 *
 *   * **wallet** — "Apple Wallet" is the name of an OS app, and the pass lives in it. Banning the word would make the
 *     copy worse and the product less clear, so the allowlist is the phrase, not the word.
 *   * **network** — "no network mark" is a statement about the card face, not about a chain. Same treatment.
 *
 * Comments are exempt: a code comment explaining that we strip the network name should be allowed to say "network".
 *
 * Exit 0 clean · 1 a banned word appears in user-visible copy.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/vouchguard/src";
const BANNED = [
  { re: /\busdc\b/i, why: "name a currency, not a budget" },
  { re: /\bon-?chain\b/i, why: "the reader does not have a chain" },
  { re: /\bblockchain\b/i, why: "same" },
  { re: /\bgas\b/i, why: "a fee the reader will never see" },
  { re: /\bsmart contract\b/i, why: "same" },
];
/** Phrases where a banned word is the correct word. Matched case-insensitively before the ban is applied. */
const ALLOWED = [/apple\s*wallet/gi, /no network mark/gi];

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx?|jsx?)$/.test(entry)) yield path;
  }
}

const problems = [];
for (const file of files(ROOT)) {
  let text = readFileSync(file, "utf8");
  // Strip comments: a comment may name the thing it explains.
  text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const allow of ALLOWED) text = text.replace(allow, "");
  for (const { re, why } of BANNED) {
    const match = text.match(re);
    if (match) problems.push(`${file}: "${match[0]}" — ${why}`);
  }
}

if (problems.length > 0) {
  console.error(`demo-vocabulary: ${problems.length} banned word(s) in user-visible copy — ${problems.length === 1 ? "it" : "they"} should say budget, not crypto`);
  for (const p of problems) console.error("  " + p);
  console.error("  the demo is for an SME: budget, top up, balance, refusal, limit. Apple Wallet is allowed; a chain name is not.");
  process.exit(1);
}
console.log("demo-vocabulary: no crypto nouns in the demo's copy (Apple Wallet and 'no network mark' allowed)");
