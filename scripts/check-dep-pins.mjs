#!/usr/bin/env node
/**
 * Internal dependency pins must match the workspace version.
 *
 * `@paystage/mcp` pinned `@paystage/preflight: "0.3.0"` while the workspace was on 0.5.0, so `npx @paystage/mcp` installed an
 * evaluator missing the malformed-payee rule and time windows — the published path was weaker than the repo, and nothing
 * failed. Exact pins are good; exact pins to a stale version are a silent downgrade for every user.
 *
 *   node scripts/check-dep-pins.mjs
 *
 * Exit 0 clean · 1 any internal pin that is not the workspace version.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PKGS = join(ROOT, "packages");
const versions = new Map();
for (const dir of readdirSync(PKGS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const manifest = join(PKGS, dir.name, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.name) versions.set(pkg.name, pkg.version);
}

const problems = [];
for (const [name, version] of versions) {
  const dir = readdirSync(PKGS, { withFileTypes: true }).find((d) => {
    const m = join(PKGS, d.name, "package.json");
    return existsSync(m) && JSON.parse(readFileSync(m, "utf8")).name === name;
  });
  if (!dir) continue;
  const pkg = JSON.parse(readFileSync(join(PKGS, dir.name, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (!versions.has(dep)) continue;
      const want = versions.get(dep);
      if (range !== want) problems.push(`${name} → ${dep}: "${range}" but the workspace has ${want}`);
    }
  }
}

if (problems.length === 0) {
  console.log(`dep-pins: all ${versions.size} internal pins match the workspace`);
  process.exit(0);
}
console.error(`dep-pins: ${problems.length} stale internal pin(s) — a published package would install an older sibling:`);
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
