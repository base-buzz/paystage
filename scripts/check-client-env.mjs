#!/usr/bin/env node
/**
 * A client component must not read `process.env`.
 *
 *   node scripts/check-client-env.mjs
 *
 * Exit 0 no `"use client"` module reads the environment · 1 one does · 2 a source tree could not be read.
 *
 * Why, 2026-11-20 (#418): `SiweStub` read `process.env.NEXT_PUBLIC_SIWE_ENABLED` in a client module. Next inlines a
 * `NEXT_PUBLIC_` variable **at build time** — but this site runs on `@opennextjs/cloudflare`, whose bootstrap copies
 * the Worker's request-time variables onto `process.env` for the server. So the server rendered the enabled branch
 * from the live Worker env while the browser bundle evaluated a `process` shim, got `false`, and rendered the
 * fallback. React logged #418 once and recovered, which is why a visitor saw a normal page and nothing else noticed
 * for a day.
 *
 * The rule that follows is not "avoid NEXT_PUBLIC_" — it is that a value a client component renders must be resolved
 * on the server and passed as a prop, so the two renders cannot disagree. `ChainTicker` had the same shape with
 * `NEXT_PUBLIC_CHAIN_ENDPOINT` and was fixed the same way.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["apps/console/src"].map((p) => join(ROOT, p));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let files;
try {
  files = APPS.flatMap((dir) => walk(dir));
} catch (error) {
  console.error(`client-env: cannot read the app source — ${error.code ?? error.message}`);
  process.exit(2);
}

const offenders = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  // `"use client"` must be the first directive of the module, so it is near the top of the file.
  const head = source.slice(0, 400);
  if (!/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\n)*["']use client["']/m.test(head)) continue;
  /**
   * Comments are stripped first: the fix's own explanation quotes the variable it removed, and a check that reads its
   * own rationale as a violation teaches people to delete the explanation.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const match = /process\.env\.([A-Z0-9_]+)/.exec(code);
  if (!match) continue;
  const line = code.slice(0, match.index).split("\n").length;
  offenders.push({ file: file.replace(`${ROOT}/`, ""), line, variable: match[1] });
}

if (offenders.length > 0) {
  for (const o of offenders) {
    console.error(`  FAIL ${o.file}:${o.line} — a client component reads process.env.${o.variable}`);
  }
  console.error(`client-env: ${offenders.length} client module(s) read the environment; resolve the value on the server`);
  console.error(`  why: NEXT_PUBLIC_ variables are inlined at build time, but @opennextjs/cloudflare also copies the`);
  console.error(`  Worker's request-time env onto process.env for the server, so the two renders can disagree (React #418)`);
  process.exit(1);
}

console.log(`client-env: ${files.length} app source file(s), no client component reads process.env`);
process.exit(0);
