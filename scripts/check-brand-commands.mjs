#!/usr/bin/env node
/**
 * Every command `/brand` tells a stranger to run must exist (#488).
 *
 * The page promises "fork the repository and run these" — and the promise decays in one direction: someone renames an npm script, the
 * page keeps the old name, and the reader gets `Missing script` with no hint that the page is out of date. A command list is a claim
 * about `package.json`, so it is checked the same way a number is.
 *
 * Exit 0 every listed script exists · 10 one is missing · 11 the page or the manifest cannot be read.
 */
import { readFileSync } from "node:fs";

const PAGE = "apps/vouchguard/src/app/brand/page.tsx";
const MANIFEST = "package.json";

let page;
try {
  page = readFileSync(PAGE, "utf8");
} catch (error) {
  console.error(`brand-commands: cannot read ${PAGE} (${error instanceof Error ? error.message : String(error)})`);
  process.exit(11);
}

/** Scripts are resolved **per directory**: the page legitimately says `cd apps/vouchguard && npm run deploy:prod`, and that script
 * lives in the app's manifest, not the root one. Resolving everything against the root reported that as a missing command. */
const scriptsFor = (dir) => {
  const path = dir === "" ? MANIFEST : `${dir}/package.json`;
  try {
    return JSON.parse(readFileSync(path, "utf8")).scripts ?? {};
  } catch {
    return null;
  }
};

/** Each `command:` string the page renders. */
const commands = [...page.matchAll(/command:\s*"([^"]+)"/g)].map((m) => m[1]);
if (commands.length === 0) {
  console.error(`brand-commands: ${PAGE} lists no commands — the parse is wrong, or the page changed shape`);
  process.exit(11);
}

const problems = [];
for (const command of commands) {
  /**
   * `cd paystage` is the directory the clone just created — it is the repo root by another name, so it resolves against the root
   * manifest rather than being reported as a missing package.json.
   */
  const cdTarget = /(?:^|&&\s*)cd\s+(\S+)/.exec(command)?.[1] ?? "";
  const dir = cdTarget === "" || /(?:^|\/)paystage\/?$/.test(cdTarget) ? "" : cdTarget;
  const scripts = scriptsFor(dir);
  if (scripts === null) {
    problems.push(`"${command}" changes into ${dir}, which has no package.json`);
    continue;
  }
  for (const match of command.matchAll(/npm run ([\w:.-]+)/g)) {
    const script = match[1];
    if (!(script in scripts)) {
      problems.push(`the page tells the reader to run "npm run ${script}" in ${dir || "the repo root"}, but that manifest has no such script`);
    }
  }
}

if (problems.length > 0) {
  console.error(`brand-commands: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(10);
}
console.log(`brand-commands: ${commands.length} command(s) on /brand, every named script exists in package.json`);
