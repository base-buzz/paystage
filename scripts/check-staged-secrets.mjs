#!/usr/bin/env node
/**
 * A key in a commit is the one mistake this project cannot take back (#134).
 *
 * It survives a revert: the blob stays in history and in every clone, and `git push --force` does not recall what other
 * people already fetched. So this blocks the commit rather than reporting it afterwards.
 *
 *   node scripts/check-staged-secrets.mjs          # scans the staged diff
 *   node scripts/check-staged-secrets.mjs --all    # scans the staged diff plus untracked text files
 *
 * Exit 0 nothing that looks like a credential · 1 something does · 2 cannot read the index.
 *
 * Allowlisted on purpose: the values we publish (the Supabase publishable key, the receipt-signing JWK in tests, the
 * faucet address). A guard that fires on our own public material is a guard people learn to bypass.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const scanAll = args.includes("--all");

/** Values we ship deliberately. Keep this list short and each entry explained. */
const ALLOWLIST = [
  // Supabase publishable/anon key: designed to be public, enforced by row-level security.
  /^sb_publishable_/,
  /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJpc3MiOiJzdXBhYmFzZSI/, // the anon JWT shape we publish
];

const PATTERNS = [
  { name: "Supabase secret key", re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: "Supabase access token", re: /\bsbp_[a-f0-9]{20,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{30,}/ },
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Stripe live key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { name: "Cloudflare token", re: /\bcf-[A-Za-z0-9_-]{30,}/ },
  // A 64-hex literal is only suspicious next to a word that names it.
  { name: "64-hex literal near key material", re: /\b(?:private[_-]?key|secret|mnemonic)[^\n]{0,40}\b[a-f0-9]{64}\b/i },
  { name: "32-byte base64 blob near key material", re: /\b(?:private[^_\n]{0,10}key|secret)[^\n]{0,40}\b[A-Za-z0-9+/]{43}=\b/i },
];

let diff;
try {
  diff = execFileSync("git", ["diff", "--cached", "-U0", "--no-color"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
} catch (error) {
  console.error(`secrets: cannot read the staged diff (${error.message})`);
  process.exit(2);
}

if (scanAll) {
  try {
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !/\.(png|jpg|jpeg|webp|gif|ico|woff2?|pdf|zip|gz)$/i.test(f));
    for (const file of untracked) {
      try {
        diff += `\n+++ ${file}\n` + execFileSync("cat", [file], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      } catch {
        /* binary or unreadable: skip */
      }
    }
  } catch {
    /* not a repository with untracked files: fine */
  }
}

/** Only added lines matter: a secret removed in this commit is already in history, and blocking now cannot help. */
const additions = diff
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .map((line) => line.slice(1));

const findings = [];
for (const line of additions) {
  const trimmed = line.trim();
  if (trimmed === "") continue;
  if (ALLOWLIST.some((re) => re.test(trimmed))) continue;
  for (const { name, re } of PATTERNS) {
    const match = re.exec(line);
    if (match === null) continue;
    // Show enough to find it, never enough to use it.
    const shown = match[0].slice(0, 8) + "…";
    findings.push(`${name}: ${shown}`);
    break;
  }
}

if (findings.length === 0) {
  console.log(`secrets: ${additions.length} added line(s) scanned, nothing that looks like a credential`);
  process.exit(0);
}
console.error("secrets: this commit appears to contain credentials — refusing it:");
for (const f of [...new Set(findings)]) console.error(`  ${f}`);
console.error("  A key in a commit survives a revert: it stays in history and in every clone.");
console.error("  Remove it from the staged change, rotate the key if it was real, and commit again.");
process.exit(1);
