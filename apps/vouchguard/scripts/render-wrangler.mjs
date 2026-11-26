#!/usr/bin/env node
/**
 * Render `wrangler.toml` from `wrangler.toml.template` and the repo-root `brand.json`.
 *
 * Wrangler has no variable interpolation for routes, and writing the domain in
 * `wrangler.toml` would make the fork edit two files. So `wrangler.toml` is a generated,
 * gitignored artefact: the template holds the settings, `brand.json` holds the name and
 * domain, and this script joins them. `deploy:prod` runs it before the OpenNext build.
 *
 * The generated file is not committed, which is the point: a fork changes brand.json,
 * runs the deploy command, and never sees a diff in this app's config.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBrandConfig } from "../src/lib/brand.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");
const BRAND_FILE = resolve(REPO_ROOT, "brand.json");
const TEMPLATE = resolve(APP_ROOT, "wrangler.toml.template");
const OUTPUT = resolve(APP_ROOT, "wrangler.toml");

let config;
try {
  config = parseBrandConfig(JSON.parse(readFileSync(BRAND_FILE, "utf8")), process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const workerName = config.name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
if (workerName === "") {
  console.error('brand.json: "name" must contain at least one letter or digit to form a Worker name');
  process.exit(1);
}

const rendered = readFileSync(TEMPLATE, "utf8")
  .replaceAll("__WORKER_NAME__", workerName)
  .replaceAll("__DOMAIN__", config.domain);

writeFileSync(OUTPUT, rendered);
console.log(`wrangler: wrote wrangler.toml (worker ${workerName}, domain ${config.domain})`);
