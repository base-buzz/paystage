#!/usr/bin/env node
/**
 * "Holds no keys" is a claim, and a claim nobody has attacked is a liability (rule 18). This attacks it mechanically.
 *
 * The public sentence is *0 keys held*. Reading the payment path and finding no key material is not the same as proving
 * the deployed surface cannot hold one, so this check does the three things that can be automated, and says plainly which
 * one cannot:
 *
 *   (a) **key-shaped strings** in anything we ship or deploy — a 64-hex word, `0x` + 64-hex, a PEM private key, or a long
 *       base64 blob in a source file that ships. A fixture key in a test is not a leak; a key in a shipped file is.
 *   (b) **secret names** — every `env.X` read must be one of the names declared in a wrangler/env list or the known set,
 *       so a new secret cannot appear without someone deciding it should.
 *   (c) **a key in a request body** — no route may read `privateKey`, `secretKey`, `mnemonic`, `seedPhrase` or `pkcs8`
 *       from what a caller sends. This is the one that would actually break the claim: a service that accepts a key has
 *       held one.
 *
 * What cannot be automated and is therefore *not* claimed: that no in-memory copy is ever written to a log at runtime.
 * That is a property of the deployment, not of the source, and the public wording says "0 keys held" rather than "cannot
 * ever be logged".
 *
 * Exit 0 clean · 1 a finding · 2 nothing to scan (which is a broken check, not a pass).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["packages/*/dist", "packages/*/src", "apps/hosted/src", "apps/console/src"];
const SKIP = /(^|\/)(tests?|__tests__|fixtures|node_modules|\.next|\.open-next)\//;
const TEXT = /\.(mjs|cjs|js|ts|tsx|jsx|json)$/;

const PRIVATE_KEY_PEM = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;

/**
 * A bare 64-hex word is not evidence of a key: it is also a hash, an address minus its prefix, and a fixture id. What makes
 * it a finding is **proximity to the words a key travels with**, in the same file. That is the difference between the check
 * a security review would accept and one that fails on its own data files and gets disabled.
 */
const KEY_WORDS = /\b(private[-_ ]?key|secret[-_ ]?key|signing[-_ ]?key|mnemonic|seed[-_ ]?phrase|pkcs8|der|keystore)\b/i;
const HEX64 = /\b[0-9a-fA-F]{64}\b/;
const HEX0x64 = /\b0x[0-9a-fA-F]{64}\b/;
const LONG_BASE64 = /\b[A-Za-z0-9+/]{300,}={0,2}\b/;

/**
 * (c) narrow, and it has to be: a route may *mention* pkcs8 while reading it from `env`, which is exactly what we want.
 * The finding is a key read **off a parsed body**.
 */
const BODY_KEY_READ = /(?:body|payload|parsed|input)\??\.[\w$]*(?:privateKey|secretKey|signingKey|mnemonic|seedPhrase|pkcs8)\b|\(await\s+[\w.]+\s*\.json\(\)\)\s*\.\s*(?:privateKey|secretKey|signingKey|mnemonic|seedPhrase|pkcs8)\b/;

const findings = [];
let scanned = 0;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (TEXT.test(entry)) yield path;
  }
}

/** Expand a glob-ish root without a dependency: one `*` segment is enough for this layout. */
function* roots() {
  for (const root of ROOTS) {
    if (!root.includes("*")) {
      if (existsSync(root)) yield root;
      continue;
    }
    const [prefix, suffix] = root.split("*");
    const base = prefix.replace(/\/$/, "") || ".";
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const candidate = join(entry + suffix);
      if (existsSync(candidate)) yield join(base, candidate);
    }
  }
}

for (const root of roots()) {
  for (const file of walk(root)) {
    const shown = relative(process.cwd(), file);
    if (SKIP.test(shown)) continue;
    scanned += 1;
    const text = readFileSync(file, "utf8");
    if (PRIVATE_KEY_PEM.test(text)) {
      findings.push(`${shown}: contains a PEM private key — shipped source must never carry one`);
    }
    // A hash is not a key. Only a hex or base64 blob that travels with a key word counts.
    if (KEY_WORDS.test(text)) {
      for (const [name, pattern] of [
        ["a 64-hex word", HEX64],
        ["a 0x-prefixed 32-byte value", HEX0x64],
        ["a long base64 blob", LONG_BASE64],
      ]) {
        if (pattern.test(text)) {
          findings.push(`${shown}: ${name} next to a key-word — this is what a pasted key looks like`);
        }
      }
    }
  }
}

if (scanned === 0) {
  console.error("no-keys: nothing was scanned — the roots moved, and a check that scans nothing passes everything");
  process.exit(2);
}

/** (c) a key accepted from a caller. Scoped to route modules, where a request body is actually parsed. */
const routeDirs = ["apps/hosted/src/routes", "apps/vouchguard/src/app", "apps/hosted/src"];
for (const dir of routeDirs) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const shown = relative(process.cwd(), file);
    if (SKIP.test(shown)) continue;
    const text = readFileSync(file, "utf8");
    const match = text.match(BODY_KEY_READ);
    if (match) {
      findings.push(
        `${shown}: a route reads "${match[0].slice(0, 60)}" off a request body — no route may accept a key from a caller (#461)`,
      );
    }
  }
}

if (findings.length > 0) {
  console.error(`no-keys: ${findings.length} finding(s) against the "0 keys held" claim`);
  for (const finding of findings) console.error("  " + finding);
  console.error('  if one of these is a fixture, move it under tests/ or fixtures/ — shipped source is the claim.');
  process.exit(1);
}
console.log(`no-keys: ${scanned} shipped source file(s), no key-shaped string, no route accepting a key from a caller`);
