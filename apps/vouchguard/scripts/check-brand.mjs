#!/usr/bin/env node
/**
 * Fail the build before Next starts if `brand.json` is malformed or an `apple` build has
 * no signing certificate.
 *
 * `prebuild` and `predev` run this, and `deploy:prod` calls it first. The same validator
 * runs again when `src/lib/brand-config.ts` is imported, so a direct `next build` also
 * fails; this script exists to make the failure fast and to name the file rather than a
 * React stack frame.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBrandConfig } from "../src/lib/brand.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BRAND_FILE = resolve(REPO_ROOT, "brand.json");

try {
  const raw = JSON.parse(readFileSync(BRAND_FILE, "utf8"));
  const config = parseBrandConfig(raw, process.env);
  console.log(`brand: ok — ${config.name}, ${config.domain}, mode=${config.mode}`);
} catch (error) {
  // The validator already prefixes `brand.json:` and names the environment variable.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
