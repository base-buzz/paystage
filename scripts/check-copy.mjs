#!/usr/bin/env node
/**
 * Copy drift gate. The README is the product for anyone evaluating us, and it goes stale in
 * ways tests never catch: a hardcoded version, a listing URL that moved, a link that 404s.
 *
 *   node scripts/check-copy.mjs            # local checks only, fast
 *   node scripts/check-copy.mjs --network  # also resolve every external link
 *
 * Exit 1 on a stale version or a broken local link; exit 2 if a network link is unreachable
 * (unreachable may be a transient block, so it warns rather than failing the build).
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const network = process.argv.includes("--network");

const readmes = [`${ROOT}README.md`, `${ROOT}packages/mcp/README.md`].filter((p) => existsSync(p));
for (const dir of readdirSync(`${ROOT}packages`, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const p = `${ROOT}packages/${dir.name}/README.md`;
  if (existsSync(p) && !readmes.includes(p)) readmes.push(p);
}

const problems = [];
const warnings = [];

/** Collect the package versions we ship, so a README cannot hardcode a stale one. */
const versions = new Map();
for (const dir of readdirSync(`${ROOT}packages`, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const pj = `${ROOT}packages/${dir.name}/package.json`;
  if (!existsSync(pj)) continue;
  const j = JSON.parse(readFileSync(pj, "utf8"));
  versions.set(j.name, j.version);
}

for (const file of readmes) {
  const text = readFileSync(file, "utf8");
  const short = file.replace(ROOT, "");

  // 1. No hardcoded version for a package we publish.
  for (const [name, version] of versions) {
    if (!text.includes(name)) continue;
    const escaped = name.replace(/[/@]/g, "\\$&");
    const mentioned = [...text.matchAll(new RegExp(`${escaped}[^\\n]{0,40}?(\\d+\\.\\d+\\.\\d+)`, "g"))];
    for (const m of mentioned) {
      if (m[1] !== version) {
        problems.push(`${short}: mentions ${name} ${m[1]} but the package is ${version}`);
      }
    }
  }

  // 2. Local links must exist.
  for (const m of text.matchAll(/\]\(([^)#][^)]*)\)/g)) {
    const target = m[1].trim();
    if (/^https?:/.test(target) || target.startsWith("mailto:")) continue;
    const resolved = resolve(dirname(file), target.split("#")[0]);
    if (!existsSync(resolved)) problems.push(`${short}: dead relative link -> ${target}`);
  }

  // 3. Install commands must be runnable. @paystage/mcp publishes two bins, so
  //    `npx -y @paystage/mcp` fails with "could not determine executable to run" — it was
  //    in every readme for three releases and no test read prose.
  for (const bad of [/npx\s+-y\s+@paystage\/mcp(?!\s+-p)/]) {
    if (bad.test(text)) problems.push(`${short}: documented command cannot run — needs -p @paystage/mcp paystage-mcp`);
  }

  // 4. The claim the whole project rests on must be present, in some form.
  if (/^#/m.test(text) && !/pay\b.*review\b.*do_not_pay/s.test(text.replace(/\s+/g, " "))) {
    warnings.push(`${short}: does not state the pay / review / do_not_pay verdict`);
  }
}

if (network) {
  const seen = new Set();
  for (const file of readmes) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) {
      const url = m[1].trim();
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) });
        // npmjs.com answers 403 to non-browser clients. Reachable, just guarded — warning
        // about it every run trains the reader to ignore the output.
        const botBlocked = res.status === 403 && /npmjs\.com$/.test(new URL(url).hostname.replace(/^www\./, ""));
        if (res.status >= 400 && !botBlocked) warnings.push(`unreachable (HTTP ${res.status}): ${url}`);
      } catch {
        warnings.push(`unreachable (network): ${url}`);
      }
    }
  }
}

for (const w of warnings) console.error(`copy warn: ${w}`);
if (problems.length > 0) {
  console.error("copy problems:");
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`copy ok: ${readmes.length} readmes${network ? `, ${warnings.length} network warnings` : ""}`);
