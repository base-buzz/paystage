#!/usr/bin/env node
/**
 * Write `/mocks/index.json` from the same data the six pages render.
 *
 *   node scripts/gen-mocks-index.mjs
 *
 * The page imports `apps/console/src/lib/mocks-stories.json`; this script reads that exact file and projects it to the
 * proposal's schema. Hand-editing `public/mocks/index.json` is therefore pointless: `check-mocks-index.mjs` compares
 * it with this projection and fails when they differ.
 *
 * Exit 0 wrote it · 1 the source cannot be read or parsed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { INDEX_PATH, SOURCE_PATH, buildIndex } from "./lib/mocks-index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let source;
try {
  source = JSON.parse(readFileSync(join(ROOT, SOURCE_PATH), "utf8"));
} catch (error) {
  console.error(`mocks-index: cannot read ${SOURCE_PATH} — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!Array.isArray(source.stories)) {
  console.error(`mocks-index: ${SOURCE_PATH} has no stories array`);
  process.exit(1);
}

const index = buildIndex(source.stories);
writeFileSync(join(ROOT, INDEX_PATH), `${JSON.stringify(index, null, 2)}\n`);
console.log(`mocks-index: wrote ${INDEX_PATH} — ${index.stories.length} stories, ${index.stories.reduce((n, story) => n + story.frames.length, 0)} frames`);
