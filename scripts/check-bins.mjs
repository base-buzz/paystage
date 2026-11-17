#!/usr/bin/env node
/**
 * `npx -y @paystage/mcp` must resolve to exactly one thing, and it must be the server.
 *
 * Found 2026-11-17 from a directory listing that could not load our tools: mcp.so runs
 * `npx -y @paystage/mcp`, and npm answered `could not determine executable to run` — because the
 * package declares four bins and none of them is named `mcp`. The process died before speaking
 * MCP, the directory reported `MCP error -32000: Connection closed`, and the page fell back to a
 * five-tool cache from an older version. Every aggregator that generates a config from metadata
 * hits the same wall, and so does anyone copying the one-liner from a directory.
 *
 * npm's rule: with one bin it uses it; with several it looks for a bin whose name equals the
 * package name without its scope (`@paystage/mcp` → `mcp`). So for a multi-bin package, that
 * alias has to exist.
 *
 *   node scripts/check-bins.mjs
 *
 * Exit 0 every package resolves · 1 a multi-bin package has no name-matching bin.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trees = ["packages", "apps"];

const problems = [];
const checked = [];

for (const tree of trees) {
  const base = join(ROOT, tree);
  if (!existsSync(base)) continue;
  for (const dir of readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifest = join(base, dir.name, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (!pkg.bin || typeof pkg.bin !== "object") continue;

    const bins = Object.keys(pkg.bin);
    const unscoped = String(pkg.name ?? "").split("/").pop();
    checked.push(`${pkg.name} (${bins.length} bin${bins.length === 1 ? "" : "s"})`);

    if (bins.length === 1) continue;
    if (!bins.includes(unscoped)) {
      problems.push(
        `${pkg.name}: ${bins.length} bins (${bins.join(", ")}) and none is named \`${unscoped}\`, so \`npx -y ${pkg.name}\` fails with "could not determine executable to run"`,
      );
    }
  }
}

if (problems.length === 0) {
  console.log(`check-bins: ${checked.length} package(s) with bins resolve from a bare \`npx <package>\``);
  console.log(`  ${checked.join("\n  ")}`);
  process.exit(0);
}
console.error(`check-bins: ${problems.length} package(s) cannot be launched by their own name:`);
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
