#!/usr/bin/env node
/**
 * Every published version should carry an npm provenance attestation — or say in the open that it does not.
 *
 * `@paystage/x402-guard@0.1.0` was published by hand and has no attestation. A caveat in a README is not a check:
 * it is a sentence that stays true only as long as someone keeps it there. This asks npm.
 *
 *   node scripts/check-provenance.mjs            # exit 0 all attested or explained, 1 a gap is unexplained
 *   node scripts/check-provenance.mjs --json
 *
 * Known-unsigned versions live in `scripts/provenance-exceptions.json` with a reason. An exception without a reason
 * fails the check, because "we knew" and "we noted why" are different states.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org";
const EXCEPTIONS = join(ROOT, "scripts/provenance-exceptions.json");

function exceptions() {
  if (!existsSync(EXCEPTIONS)) return {};
  try {
    return JSON.parse(readFileSync(EXCEPTIONS, "utf8"));
  } catch {
    console.error("provenance: scripts/provenance-exceptions.json is not valid JSON — cannot tell an explained gap from an unexplained one");
    process.exit(2);
  }
}

function packages() {
  const out = [];
  for (const dir of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifest = join(ROOT, "packages", dir.name, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (pkg.private || !pkg.name?.startsWith("@paystage/")) continue;
    out.push(pkg.name);
  }
  return out.sort();
}

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const exc = exceptions();
const problems = [];
const rows = [];

for (const name of packages()) {
  const encoded = name.replace("/", "%2F");
  let doc;
  try {
    doc = await get(`${REGISTRY}/${encoded}`);
  } catch (error) {
    problems.push(`${name}: registry unreadable (${error.message})`);
    continue;
  }
  const latest = doc?.["dist-tags"]?.latest;
  const version = doc?.versions?.[latest];
  if (!version) {
    problems.push(`${name}: no latest version`);
    continue;
  }
  // npm exposes the attestation URL on the version's dist object when one was published.
  const attested = Boolean(version.dist?.attestations?.url ?? version.dist?.attestations);
  const excused = exc[`${name}@${latest}`];
  if (!attested && !excused?.reason) {
    problems.push(`${name}@${latest}: no provenance attestation and no recorded reason`);
  }
  rows.push({ name, version: latest, attested, excused: excused?.reason ?? null });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: problems.length === 0, rows, problems }, null, 2));
} else {
  for (const r of rows) console.log(`  ${r.name.padEnd(28)} ${r.version.padEnd(8)} ${r.attested ? "attested" : `UNSIGNED — ${r.excused ?? "no reason recorded"}`}`);
  console.log(problems.length === 0 ? `\nprovenance: ${rows.length} package(s), every gap explained` : `\nprovenance: ${problems.length} problem(s)\n${problems.map((p) => `  ${p}`).join("\n")}`);
}
process.exit(problems.length === 0 ? 0 : 1);
