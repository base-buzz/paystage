#!/usr/bin/env node
/**
 * The things a push can leak or break that no other check in this repo looks at.
 *
 * Existing hooks cover copy, versions, routes, dependencies, artifacts and secrets **inside the diff**
 * (`check-staged-secrets.mjs`). Three gaps remained, and each has a concrete failure behind it:
 *
 *  1. a **secret file** committed by path — `.env`, `.secrets/`, a `.pem`, a key store. The content scanner cannot see a
 *     file whose body is a plausible-looking blob, but the path says exactly what it is;
 *  2. a **workflow with write permissions** — `contents: write` on a workflow that runs on `pull_request` lets a fork
 *     change the repository it was opened against;
 *  3. a **dependency with an install script** — npm runs those at install time, before any test, on every machine that
 *     installs the package. `npm-check` flags them; nothing enforced it.
 *
 *   node scripts/check-security.mjs
 *
 * Exit 0 nothing found · 1 something · 2 cannot read.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

/** 1. Files that are credentials by name, not by content. */
const FORBIDDEN_PATHS = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.secrets(\/|$)/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /(^|\/)\.creds$/,
  /(^|\/)credentials\.ya?ml$/,
];

let tracked = [];
try {
  tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
} catch (error) {
  console.error(`security: cannot list tracked files (${error.message})`);
  process.exit(2);
}

for (const file of tracked) {
  if (file.startsWith(".env.example") || file.endsWith(".env.example")) continue;
  if (FORBIDDEN_PATHS.some((re) => re.test(file))) problems.push(`tracked credential-shaped file: ${file}`);
}

/** 2. Workflows that can write on a pull_request trigger. */
const WORKFLOWS = join(ROOT, ".github/workflows");
if (existsSync(WORKFLOWS)) {
  for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    const onPullRequest = /^\s{2}pull_request(_target)?:/m.test(text) || /^\s{2}pull_request:/m.test(text);
    if (!onPullRequest) continue;
    const writeScope = /\b(contents|issues|pull-requests|actions|packages|deployments|id-token):\s*write/.exec(text);
    if (writeScope) {
      problems.push(`${file}: runs on pull_request and grants ${writeScope[1]}: write — a fork would have that permission`);
    }
  }
}

/** 3. Dependencies whose install runs code on every machine. */
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];
for (const dir of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const manifestPath = join(ROOT, "packages", dir.name, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const script of INSTALL_SCRIPTS) {
    const command = manifest.scripts?.[script];
    if (command === undefined) continue;
    // Our own workspace packages are installed from source by us; the risk this guards is a third-party tarball.
    if (manifest.private) continue;
    problems.push(`${manifest.name}: declares a \`${script}\` script ("${command}") that runs on every install of the published package`);
  }
}

/** 4. A lockfile that disagrees with its manifest ships whatever the lockfile says. */
const rootManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const declared = new Set(Object.keys(rootManifest.dependencies ?? {}).concat(Object.keys(rootManifest.devDependencies ?? {})));
const lockPath = join(ROOT, "package-lock.json");
if (declared.size > 0 && existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  for (const name of declared) {
    const present = Object.keys(lock.packages ?? {}).some((key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
    if (!present) problems.push(`${name} is declared in package.json but absent from package-lock.json — the install would not match the manifest`);
  }
}

if (problems.length === 0) {
  console.log(`security: ${tracked.length} tracked file(s), ${readdirSync(WORKFLOWS).length} workflow(s), every boundary clear`);
  process.exit(0);
}
console.error("security: these are the things a push should not carry:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
