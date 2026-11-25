#!/usr/bin/env node
/**
 * Every policy example that ships must parse with the product's own `parsePolicy`.
 *
 *   node scripts/check-examples.mjs
 *
 * The landing-page draft's policy sample failed with five errors from our own validator — missing
 * version/decimals/allowed_pay_to/allowed_assets/max_timeout_seconds — while `validate_policy` was
 * advertised in the same document. An example that a reader pastes into the product and gets errors
 * from is worse than no example, because it looks like a working configuration.
 *
 * The check imports the built policy package (the same parser the MCP tool calls). When `dist` is
 * missing or older than `src` — the fast ci-local pass runs checks before the full build — it builds
 * only that package first.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_DIR = join(ROOT, "packages/policy");
const DIST = join(POLICY_DIR, "dist/index.js");

function newestMtime(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path).reduce((newest, entry) => Math.max(newest, newestMtime(join(path, entry))), 0);
}

if (!existsSync(DIST) || newestMtime(join(POLICY_DIR, "src")) > statSync(DIST).mtimeMs) {
  console.log("examples: building @paystage/policy so the check uses the current parser");
  execFileSync("npm", ["run", "build", "-w", "@paystage/policy", "--silent"], { cwd: ROOT, stdio: "inherit" });
}

const { parsePolicy } = await import(pathToFileURL(DIST).href);

const files = [
  ...readdirSync(join(ROOT, "examples/policies"))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join("examples/policies", name)),
  "examples/policy.example.json",
];

const problems = [];
for (const file of files) {
  try {
    parsePolicy(JSON.parse(readFileSync(join(ROOT, file), "utf8")));
    console.log(`  ok    ${file}`);
  } catch (error) {
    problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`  FAIL  ${file}`);
  }
}

if (problems.length > 0) {
  console.error(`\nexamples: ${problems.length} policy example(s) do not parse — fix the example, not the parser`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`\nexamples: ${files.length} policy example(s) parse with parsePolicy`);
