#!/usr/bin/env node
/**
 * The glossary is authored in `docs/glossary.md` and needed inside the Next app — which is deployed without the rest
 * of the repository, so reading the file at runtime worked locally and 500'd in production.
 *
 * Generate the content into a TS module at build time instead: one source, no filesystem dependency at runtime, and a
 * stale copy fails a check rather than silently serving yesterday's text.
 *
 *   node scripts/sync-glossary.mjs --write
 *   node scripts/sync-glossary.mjs --check
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "docs/glossary.md");
const TARGET = join(ROOT, "apps/console/src/lib/glossary.generated.ts");

const markdown = readFileSync(SOURCE, "utf8");
const generated = `/**
 * GENERATED from docs/glossary.md — do not edit.
 *
 * The console deploys without the repository, so the glossary has to be compiled in rather than read at runtime.
 * Regenerate with \`node scripts/sync-glossary.mjs --write\`; \`--check\` fails when this file is stale.
 */
export const GLOSSARY_MARKDOWN = ${JSON.stringify(markdown)};
`;

if (process.argv.includes("--write")) {
  writeFileSync(TARGET, generated);
  console.log(`glossary: wrote ${markdown.length} chars into ${TARGET.replace(ROOT + "/", "")}`);
  process.exit(0);
}

if (!existsSync(TARGET)) {
  console.log("glossary: generated module missing — run scripts/sync-glossary.mjs --write");
  process.exit(1);
}
if (readFileSync(TARGET, "utf8") !== generated) {
  console.log("glossary: generated module is stale — run scripts/sync-glossary.mjs --write");
  process.exit(1);
}
console.log("glossary: generated module is current");
