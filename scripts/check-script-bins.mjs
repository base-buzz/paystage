#!/usr/bin/env node
/**
 * A script that runs a binary must declare it (#135).
 *
 * `@paystage/x402-guard` ran `vitest` while declaring no vitest — it worked only because a hoisted copy from another
 * package happened to be there, and a Dependabot bump rearranged the tree and broke it. Same class as the npm package
 * that served five tools: working by accident of environment.
 *
 *   node scripts/check-script-bins.mjs
 *
 * Exit 0 every script's binaries are declared · 1 one is not · 2 cannot read.
 *
 * Shell builtins and the package manager are skipped by name. A binary provided by a *dependency* counts too, because
 * that is what npm resolves at install time — the question is whether the package declares it at all.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Not binaries: shell syntax, the runner itself, and the tools every Node image has. */
const SKIP = new Set([
  "node", "npm", "npx", "pnpm", "yarn", "sh", "bash", "cd", "cp", "mv", "rm", "mkdir", "rmdir", "echo", "set",
  "export", "exit", "true", "false", "test", "[", "if", "then", "else", "fi", "for", "do", "done", "sleep", "chmod",
  "curl", "git", "tee", "grep", "sed", "awk", "cat", "head", "tail", "sort", "uniq", "wc", "xargs", "find", "env",
  "printf", "&&", "||", ";", "|", ">", ">>", "2>&1", "GH_TOKEN", "exec", "wait", "trap", "local", "read", "return",
]);

/**
 * Binaries that a dependency provides. `vitest` and `tsc` are the two this project uses; a repo-wide tool instead of a
 * dependency is declared in the root package.json and satisfies any workspace package.
 */
/**
 * The binaries a declared dependency actually provides, read from its installed manifest.
 *
 * `typescript` provides `tsc`, `@biomejs/biome` provides `biome` — name-stripping alone would call every `tsc` in this
 * repo undeclared, which is 16 false findings and a guard nobody keeps. The install is the source of truth for the
 * mapping; when a package is not installed we fall back to its name.
 */
function binsFromDeps(names) {
  const bins = new Set();
  for (const name of names) {
    bins.add(name);
    bins.add(name.replace(/^@[^/]+\//, ""));
    const manifestPath = join(ROOT, "node_modules", name, "package.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const dep = JSON.parse(readFileSync(manifestPath, "utf8"));
      const bin = dep.bin;
      if (typeof bin === "string") bins.add(name.replace(/^@[^/]+\//, ""));
      else if (bin && typeof bin === "object") for (const key of Object.keys(bin)) bins.add(key);
    } catch {
      /* an unreadable dependency manifest is not this check's problem */
    }
  }
  return bins;
}

function declaredBins(manifest, rootManifest) {
  const names = new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) names.add(name);
    // The workspace root is installed together with every package, so its devDependencies are a real declaration —
    // the failure this guards against is a binary declared *nowhere*, not one declared one level up.
    for (const name of Object.keys(rootManifest[field] ?? {})) names.add(name);
  }
  return binsFromDeps(names);
}

const problems = [];
let checked = 0;
const rootManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const packagesDir = join(ROOT, "packages");
for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const manifestPath = join(packagesDir, dir.name, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bins = declaredBins(manifest, rootManifest);

  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    checked += 1;
    // Split on shell separators, then take the first token of each segment.
    for (const segment of String(command).split(/&&|\|\||;|\|/)) {
      const first = segment.trim().split(/\s+/)[0];
      if (!first || SKIP.has(first)) continue;
      if (first.startsWith("./") || first.startsWith("-") || first.includes("=")) continue;
      if (first.endsWith(".mjs") || first.endsWith(".js")) continue;
      if (bins.has(first)) continue;
      problems.push(`${manifest.name}: script "${name}" runs \`${first}\`, which is not in dependencies or devDependencies`);
    }
  }
}

if (problems.length === 0) {
  console.log(`script-bins: ${checked} script(s), every binary declared`);
  process.exit(0);
}
console.error("script-bins: these scripts rely on a binary their package does not declare:");
for (const p of [...new Set(problems)]) console.error(`  ${p}`);
console.error("  A hoisted copy from another package is not a declaration — it disappears on the next install.");
process.exit(1);
