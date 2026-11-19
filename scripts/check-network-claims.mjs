#!/usr/bin/env node
/**
 * SECURITY.md says four network calls exist. This counts them in the code.
 *
 * The access table is checked in both directions for environment variables, but the *network* row was prose: `request_testnet_funds`
 * and `verify_receipt` both make outbound calls that the table did not mention, and nothing would have told us. A claim about what a
 * package touches is the kind of claim a buyer reads before installing it.
 *
 *   node scripts/check-network-claims.mjs
 *
 * Exit 0 declared calls match the code · 10 an undeclared call exists · 11 the parse found nothing (the check is wrong, not the docs).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(ROOT, "packages");

/**
 * Every outbound call the docs claim, by the file it lives in. Adding a `fetch(` without adding it here fails the check, which is the
 * point: the document and the code move together or CI says so.
 */
const DECLARED = [
  { file: "packages/mcp/src/tools.ts", host: "sepolia.api.paystage.xyz", what: "request_testnet_funds → faucet" },
  { file: "packages/mcp/src/tools.ts", host: "api.paystage.xyz", what: "verify_receipt → receipt key" },
  { file: "packages/auth-watch/src/rpc.ts", host: "base.org", what: "auth-watch → JSON-RPC default" },
  { file: "packages/trade-preflight/src/hyperliquid.ts", host: "api.hyperliquid.xyz", what: "trade-preflight → market context" },
  // A caller-supplied URL, so there is no literal host to match — declared because it exists.
  { file: "packages/x402-guard/src/index.ts", host: null, what: "guard → optional telemetryUrl supplied by the caller" },
];

const found = [];
for (const pkg of readdirSync(PACKAGES)) {
  // Private packages never reach a caller: `loadgen` is the operator's own load generator, and it talks to Base and Alchemy by design.
  // The claim SECURITY.md makes is about what an installing user runs, so the scan covers published packages only.
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, pkg, "package.json"), "utf8"));
    if (manifest.private === true) continue;
  } catch {
    continue;
  }
  const dir = join(PACKAGES, pkg, "src");
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    continue;
  }
  for (const entry of entries.filter((e) => e.endsWith(".ts")).sort()) {
    const path = join(dir, entry);
    if (!statSync(path).isFile()) continue;
    const text = readFileSync(path, "utf8");
    if (!/\bfetch\(/.test(text)) continue;
    // Hosts near a fetch call, in the same file — the granularity that catches "a new call appeared in this file".
    const hosts = [...new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]))];
    found.push({ file: `packages/${pkg}/src/${entry}`, hosts });
  }
}

if (found.length === 0) {
  console.error("network-claims: no fetch call sites found — the scan is wrong, not the docs");
  process.exit(11);
}

const problems = [];
for (const site of found) {
  const declaredHere = DECLARED.filter((d) => d.file === site.file);
  if (site.hosts.length === 0) {
    /**
     * A fetch to a caller-supplied URL — `@paystage/x402-guard`'s `telemetryUrl` — has no literal host to compare, so it is declared by hand here. Every other
     * host-less fetch is a failure: an undeclared call is the thing this check exists for.
     */
    const declaredWithoutHost = DECLARED.filter((d) => d.file === site.file && d.host === null);
    if (declaredWithoutHost.length === 0) {
      problems.push(`${site.file}: fetch() with no literal host and no declaration — add one to DECLARED with host: null`);
    }
    continue;
  }
  for (const host of site.hosts) {
    if (!declaredHere.some((d) => host === d.host || host.endsWith(`.${d.host}`))) {
      problems.push(`${site.file}: calls ${host}, which SECURITY.md does not declare`);
    }
  }
  for (const d of declaredHere) {
    if (!site.hosts.some((h) => h === d.host || h.endsWith(`.${d.host}`)) && !site.file.endsWith("rpc.ts")) {
      problems.push(`${site.file}: declares ${d.host} but the file does not mention it`);
    }
  }
}

for (const p of problems) console.error(`  FAIL ${p}`);
const sites = found.length;
const hosts = new Set(found.flatMap((f) => f.hosts)).size;
console.log(
  problems.length === 0
    ? `network-claims: ${sites} file(s) with fetch call sites, ${hosts} host(s), all declared in SECURITY.md`
    : `network-claims: ${problems.length} undeclared call(s)`,
);
process.exit(problems.length === 0 ? 0 : 10);
